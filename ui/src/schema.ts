import type { Coordinate } from './selene';

export interface DistancePick {
  field: string;
  coordinate: Coordinate;
  distance: number;
  min?: number;
  max?: number;
}

export type SchemaDefinition =
  | string
  | {
      type: string;
      optional?: boolean;
      min?: number;
      max?: number;
      values?: Array<{ value: unknown; label: string }>;
      registry?: string;
      coordinate?: string;
      properties?: Record<string, SchemaDefinition>;
      keyType?: SchemaDefinition;
      valueType?: SchemaDefinition;
    };

export function defaultSchemaValue(definition: SchemaDefinition): unknown {
  const type = typeof definition === 'string' ? definition : definition.type;
  switch (type) {
    case 'integer':
    case 'number':
      return 0;
    case 'distance':
      return typeof definition === 'string' ? 0 : (definition.min ?? 0);
    case 'boolean':
    case 'enabled':
      return false;
    case 'range':
      return {
        min: typeof definition === 'string' ? 0 : (definition.min ?? Math.min(0, definition.max ?? 0)),
        max: typeof definition === 'string' ? 0 : (definition.min ?? Math.min(0, definition.max ?? 0)),
      };
    case 'coordinate':
      return { x: 0, y: 0, z: 0 };
    case 'object':
    case 'map':
      return {};
    case 'array':
      return [];
    case 'any':
      return null;
    case 'enum':
      return typeof definition === 'string' ? '' : (definition.values?.[0]?.value ?? '');
    default:
      return '';
  }
}
