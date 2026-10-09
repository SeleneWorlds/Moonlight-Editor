import type { Coordinate } from './selene';

export function projectedDirectionAngle(
  vector: Coordinate,
  project: (coordinate: Coordinate) => { x: number; y: number } = ({ x, y, z }) => ({
    x: (x + y) * 38,
    y: -((x - y) * 19 + z * 114),
  }),
): number {
  const origin = project({ x: 0, y: 0, z: 0 });
  const target = project(vector);
  return ((Math.atan2(target.x - origin.x, origin.y - target.y) * 180) / Math.PI + 360) % 360;
}
