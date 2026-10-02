import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import type { CameraConfig } from '../config.js';
import {
  cameraPosition,
  clampDistance,
  clampTarget,
  groundAt,
  releaseVelocity,
  stepInertia,
  toNdc,
  wheelZoomFactor,
  zoomAbout,
  ZERO,
  type Bounds,
  type CameraPose,
  type GroundPoint,
  type MotionSample,
} from './cameraMath.js';

/** Read-only snapshot for the dev overlay and Playwright hook. */
export interface MapCameraState {
  readonly target: GroundPoint;
  readonly distance: number;
  readonly flinging: boolean;
  readonly bounds: Bounds;
}

interface PointerPos {
  x: number;
  y: number;
}

/** Longest frame step the fling integrates, so a hitch can't teleport the map. */
const MAX_INERTIA_DT = 0.1;

/**
 * Top-down tilted map camera (design doc §20): one-finger pan with inertia,
 * two-finger pinch zoom (anchored under the fingers) with pan, mouse-wheel
 * zoom on desktop, all clamped to the map bounds. Uses Pointer Events
 * directly; all the maths is in cameraMath.ts.
 */
export class MapCamera {
  readonly camera: TargetCamera;

  private target: GroundPoint;
  private distance: number;
  private velocity: GroundPoint = ZERO;
  private readonly pointers = new Map<number, PointerPos>();
  private samples: MotionSample[] = [];
  private readonly scratchTarget = new Vector3();
  private readonly beforeRender: Observer<Scene> | null;
  private readonly abort = new AbortController();
  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly config: CameraConfig;
  private readonly bounds: Bounds;
  /** Set whenever target or distance change; the camera is only rewritten then. */
  private dirty = true;

  constructor(
    scene: Scene,
    canvas: HTMLCanvasElement,
    config: CameraConfig,
    bounds: Bounds,
    start: GroundPoint = ZERO,
  ) {
    this.scene = scene;
    this.canvas = canvas;
    this.config = config;
    this.bounds = bounds;
    this.target = clampTarget(start, bounds);
    this.distance = clampDistance(config.startDistance, config.minDistance, config.maxDistance);

    this.camera = new TargetCamera('map-camera', Vector3.Zero(), scene);
    this.camera.fov = config.fov;
    this.camera.minZ = 0.5;
    this.camera.maxZ = config.maxDistance * 6;
    this.apply();

    const signal = this.abort.signal;
    canvas.addEventListener('pointerdown', this.onPointerDown, { signal });
    canvas.addEventListener('pointermove', this.onPointerMove, { signal });
    canvas.addEventListener('pointerup', this.onPointerUp, { signal });
    canvas.addEventListener('pointercancel', this.onPointerUp, { signal });
    canvas.addEventListener('wheel', this.onWheel, { signal, passive: false });

    this.beforeRender = scene.onBeforeRenderObservable.add(() => {
      this.tick(scene.getEngine().getDeltaTime() / 1000);
    });
  }

  get state(): MapCameraState {
    return {
      target: this.target,
      distance: this.distance,
      flinging: this.velocity.x !== 0 || this.velocity.z !== 0,
      bounds: this.bounds,
    };
  }

  dispose(): void {
    this.abort.abort();
    this.scene.onBeforeRenderObservable.remove(this.beforeRender);
    this.camera.dispose();
  }

  private pose(): CameraPose {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    return {
      target: this.target,
      distance: this.distance,
      pitch: this.config.pitch,
      yaw: this.config.yaw,
      fov: this.config.fov,
      aspect: w / h,
    };
  }

  private groundUnder(p: PointerPos, pose = this.pose()): GroundPoint | null {
    const ndc = toNdc(p.x, p.y, this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);
    return groundAt(pose, ndc.x, ndc.y);
  }

  private localPos(e: PointerEvent | WheelEvent): PointerPos {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already-released pointers can't be captured; harmless.
    }
    this.pointers.set(e.pointerId, this.localPos(e));
    this.velocity = ZERO; // a touch catches a gliding map
    this.samples = [];
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const next = this.localPos(e);

    if (this.pointers.size === 1) {
      this.panBetween(prev, next);
    } else if (this.pointers.size === 2) {
      const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (other) this.pinch(prev, next, other);
    }
    this.pointers.set(e.pointerId, next);
    this.record(e.timeStamp);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size === 0) {
      const perDistance = this.distance;
      this.velocity = releaseVelocity(
        this.samples,
        e.timeStamp,
        this.config.velocitySampleMs,
        this.config.minFlingSpeed * perDistance,
        this.config.maxFlingSpeed * perDistance,
      );
    }
    // Lifting one finger of a pinch: start a fresh sample run so the remaining
    // finger doesn't inherit the pinch's motion.
    this.samples = [];
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const lineScale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    const factor = wheelZoomFactor(e.deltaY * lineScale, this.config.wheelZoomPer100Px);
    this.velocity = ZERO;
    this.zoomAt(this.localPos(e), this.distance * factor);
  };

  private panBetween(from: PointerPos, to: PointerPos): void {
    const pose = this.pose();
    const a = this.groundUnder(from, pose);
    const b = this.groundUnder(to, pose);
    if (!a || !b) return;
    this.target = clampTarget(
      { x: this.target.x + a.x - b.x, z: this.target.z + a.z - b.z },
      this.bounds,
    );
    this.dirty = true;
  }

  private pinch(prev: PointerPos, next: PointerPos, other: PointerPos): void {
    const midPrev = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
    const midNext = { x: (next.x + other.x) / 2, y: (next.y + other.y) / 2 };
    const spreadPrev = Math.hypot(prev.x - other.x, prev.y - other.y);
    const spreadNext = Math.hypot(next.x - other.x, next.y - other.y);
    if (spreadPrev > 1 && spreadNext > 1) {
      this.zoomAt(midPrev, (this.distance * spreadPrev) / spreadNext);
    }
    this.panBetween(midPrev, midNext);
  }

  private zoomAt(screen: PointerPos, wantedDistance: number): void {
    const distance = clampDistance(
      wantedDistance,
      this.config.minDistance,
      this.config.maxDistance,
    );
    const anchor = this.groundUnder(screen);
    if (!anchor || distance === this.distance) return;
    this.target = clampTarget(zoomAbout(this.target, anchor, this.distance, distance), this.bounds);
    this.distance = distance;
    this.dirty = true;
  }

  private record(t: number): void {
    this.samples.push({ t, p: this.target });
    const cutoff = t - this.config.velocitySampleMs * 2;
    while (this.samples.length > 2 && (this.samples[0]?.t ?? t) < cutoff) this.samples.shift();
  }

  private tick(dt: number): void {
    if (this.pointers.size === 0 && (this.velocity.x !== 0 || this.velocity.z !== 0)) {
      const next = stepInertia(
        { target: this.target, velocity: this.velocity },
        Math.min(Math.max(dt, 0), MAX_INERTIA_DT),
        this.config.inertiaTimeConstant,
        this.config.minFlingSpeed * this.distance * 0.25,
        this.bounds,
      );
      this.target = next.target;
      this.velocity = next.velocity;
      this.dirty = true;
    }
    if (this.dirty) this.apply();
  }

  /** Writes the pose into the Babylon camera. */
  private apply(): void {
    const p = cameraPosition(this.pose());
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.setTarget(this.scratchTarget.set(this.target.x, 0, this.target.z));
    this.dirty = false;
  }
}
