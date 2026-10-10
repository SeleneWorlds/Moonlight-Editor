export interface RegistryOption {
  value: string;
  label: string;
  visual?: string;
}

function objectFields(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

export function parseRegistryOptions(registry: string, options: unknown[]): RegistryOption[] {
  return options.flatMap((option) => {
    if (typeof option !== 'object' || option === null) {
      return [];
    }
    const { value, label, visual: serverVisual, data } = option as Record<string, unknown>;
    if (typeof value !== 'string' || typeof label !== 'string') {
      return [];
    }
    const fields = objectFields(data);
    const metadata = objectFields(fields.metadata);
    const visual = registry === 'visuals' || registry === 'selene:visuals' ? value
      : typeof metadata.visual === 'string' ? metadata.visual
      : typeof fields.visual === 'string' ? fields.visual
      : typeof serverVisual === 'string' ? serverVisual
      : registry === 'entities' || registry === 'selene:entities' ? value : undefined;
    return [{ value, label, ...(typeof visual === 'string' ? { visual } : {}) }];
  });
}
