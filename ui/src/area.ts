export type AreaShape =
  | { type: 'rectangle'; x: number; y: number; z: number; width: number; height: number }
  | { type: 'circle'; x: number; y: number; z: number; radius: number };
export interface Area {
  include: AreaShape[];
  exclude: AreaShape[];
}
export function containsShape(s: AreaShape, x: number, y: number, z: number): boolean {
  return (
    s.z === z &&
    (s.type === 'rectangle'
      ? x >= s.x && y >= s.y && x < s.x + s.width && y < s.y + s.height
      : (x - s.x) ** 2 + (y - s.y) ** 2 <= s.radius ** 2)
  );
}
export function containsArea(a: Area, x: number, y: number, z: number): boolean {
  return a.include.some((s) => containsShape(s, x, y, z)) && !a.exclude.some((s) => containsShape(s, x, y, z));
}
export function parseArea(value: unknown): Area {
  if (value === undefined || value === null) {
    return { include: [], exclude: [] };
  }
  const a = value as Area;
  for (const group of ['include', 'exclude'] as const) {
    if (!Array.isArray(a[group])) {
      throw new Error(`Area ${group} must be an array.`);
    }
    for (const s of a[group]) {
      if (!s || !['rectangle', 'circle'].includes(s.type)) {
        throw new Error('Unsupported area shape.');
      }
      if (![s.x, s.y, s.z].every(Number.isSafeInteger)) {
        throw new Error('Shape coordinates must be integers.');
      }
      const sizes = s.type === 'circle' ? [s.radius] : [s.width, s.height];
      if (!sizes.every((v) => Number.isSafeInteger(v) && v >= (s.type === 'circle' ? 0 : 1))) {
        throw new Error('Invalid shape size.');
      }
    }
  }
  return JSON.parse(JSON.stringify(a)) as Area;
}

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w';
export function resizeShape(shape: AreaShape, handle: ResizeHandle, x: number, y: number): AreaShape {
  if (shape.type === 'circle') {
    return { ...shape, radius: Math.round(Math.hypot(x - shape.x, y - shape.y)) };
  }
  const oppositeX = handle.includes('w') ? shape.x + shape.width - 1 : shape.x;
  const oppositeY = handle.includes('n') ? shape.y + shape.height - 1 : shape.y;
  return {
    ...shape,
    x: Math.min(x, oppositeX),
    y: Math.min(y, oppositeY),
    width: Math.abs(x - oppositeX) + 1,
    height: Math.abs(y - oppositeY) + 1,
  };
}
