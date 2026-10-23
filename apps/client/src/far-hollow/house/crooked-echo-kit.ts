import { merged, type Part } from '../../explore/kit-mesh.js';
import { ball, tube } from './crooked-kit.js';

// An echo's shape (#306 6d): a soft vinyl-toy ghost (art bible §1.2), a
// round head on a little bell of a body with a scalloped hem, two dark
// oval eyes and pink cheeks, floating off the floor. Facing −z (the
// camera) at yaw 0, centred on its own floor point. One merged,
// vertex-coloured shape; the scene draws it glowing (emissive, no light).

// TUNE: every colour and size.
const ECHO = { body: '#efe9ff', hem: '#c9bcf4', eye: '#2b2340', cheek: '#ff9fc4' } as const;

export function echoShape(): Part {
  const parts: Part[] = [
    ball(0.78, [0, 1.3, 0], ECHO.body),
    tube(0.62, 0.74, 0.86, [0, 0.95, 0], ECHO.body),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(ball(0.26, [Math.sin(a) * 0.36, 0.64, Math.cos(a) * 0.36], ECHO.hem));
  }
  for (const side of [-1, 1]) {
    parts.push(ball(0.13, [side * 0.15, 1.36, -0.35], ECHO.eye, [1, 1.45, 0.5]));
    parts.push(ball(0.11, [side * 0.27, 1.2, -0.31], ECHO.cheek, [1.3, 0.7, 0.5]));
    // Little round arms.
    parts.push(ball(0.2, [side * 0.45, 1.02, -0.05], ECHO.body, [1.3, 0.8, 0.8]));
  }
  return merged(parts);
}
