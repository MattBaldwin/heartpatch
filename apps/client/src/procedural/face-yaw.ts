/**
 * The yaw that turns a squishy (or the Keeper) to face along (dx, dz).
 *
 * Models face −z at yaw 0 (`SquishyPlacement.yaw`), and Babylon's
 * left-handed turn about +y takes −z to (−sin yaw, −cos yaw), so
 * yaw = atan2(−dx, −dz).
 */
export function faceYaw(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}
