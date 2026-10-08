import type { DistancePick } from './schema';
import type { Coordinate } from './selene';

export function pickedDistance(pick: DistancePick, coordinate: Coordinate): number {
  const distance = Math.round(Math.hypot(coordinate.x - pick.coordinate.x, coordinate.y - pick.coordinate.y));
  return Math.max(0, pick.min ?? 0, Math.min(pick.max ?? Infinity, distance));
}

export function projectedCircle(
  coordinate: Coordinate,
  distance: number,
  project: (coordinate: Coordinate) => { x: number; y: number },
): string {
  const center = project(coordinate);
  const xAxis = project({ ...coordinate, x: coordinate.x + 1 });
  const yAxis = project({ ...coordinate, y: coordinate.y + 1 });
  return Array.from({ length: 96 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    return `${center.x + x * (xAxis.x - center.x) + y * (yAxis.x - center.x)},${center.y + x * (xAxis.y - center.y) + y * (yAxis.y - center.y)}`;
  }).join(' ');
}
