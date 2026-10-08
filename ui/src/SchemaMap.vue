<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { defaultSchemaValue, type DistancePick, type SchemaDefinition } from './schema';
import SchemaForm from './SchemaForm.vue';
import RegistryVisual from './RegistryVisual.vue';

type RegistryOption = { value: string; label: string; visual?: string };

const props = defineProps<{
  keyType: SchemaDefinition;
  valueType: SchemaDefinition;
  contents: string;
  registryOptions: Record<string, Array<{ value: string; label: string; visual?: string }>>;
}>();
const emit = defineEmits<{
  updateContents: [contents: string];
  searchRegistry: [registry: string, query: string, lookup?: boolean];
  pickCoordinate: [field: string];
  pickDistance: [pick: DistancePick];
}>();
const entries = computed<Record<string, unknown>>(() => JSON.parse(props.contents));
const keyRegistry = computed(() =>
  typeof props.keyType !== 'string' && props.keyType.type === 'registry' ? props.keyType.registry : undefined,
);
const knownRegistryOptions = reactive<Record<string, Record<string, RegistryOption>>>({});

watch(
  () => props.registryOptions,
  (registries) => {
    for (const [registry, options] of Object.entries(registries)) {
      const known = (knownRegistryOptions[registry] ??= {});
      for (const option of options) {
        known[option.value] = option;
      }
    }
  },
  { immediate: true },
);

watch(
  () => ({ registry: keyRegistry.value, keys: Object.keys(entries.value) }),
  ({ registry, keys }) => {
    if (registry) {
      for (const key of keys) {
        if (!knownRegistryOptions[registry]?.[key]) {
          emit('searchRegistry', registry, key, true);
        }
      }
    }
  },
  { immediate: true },
);

function entryOption(key: string): RegistryOption | undefined {
  return keyRegistry.value ? knownRegistryOptions[keyRegistry.value]?.[key] : undefined;
}
const inlineProperties = computed(() => {
  const definition = props.valueType;
  return typeof definition !== 'string' &&
    definition.type === 'object' &&
    definition.properties &&
    Object.keys(definition.properties).length <= 3
    ? definition.properties
    : null;
});
const draft = ref('{}');
const selectedKey = computed(() => {
  const key: unknown = JSON.parse(draft.value).key;
  return typeof key === 'string' || typeof key === 'number' ? String(key) : '';
});
const duplicate = computed(() => Object.prototype.hasOwnProperty.call(entries.value, selectedKey.value));

function add(): void {
  if (!selectedKey.value || duplicate.value) {
    return;
  }
  emit(
    'updateContents',
    JSON.stringify({
      ...entries.value,
      [selectedKey.value]: defaultSchemaValue(props.valueType),
    }),
  );
  draft.value = '{}';
}

function remove(key: string): void {
  const next = { ...entries.value };
  delete next[key];
  emit('updateContents', JSON.stringify(next));
}

function entryLabel(key: string): string {
  if (typeof props.keyType !== 'string' && props.keyType.type === 'enum') {
    return props.keyType.values?.find((option) => String(option.value) === key)?.label ?? key;
  }
  return entryOption(key)?.label ?? key;
}

function updateEntry(key: string, contents: string): void {
  emit('updateContents', JSON.stringify({ ...entries.value, [key]: JSON.parse(contents).value }));
}

function updateInlineEntry(key: string, contents: string): void {
  emit('updateContents', JSON.stringify({ ...entries.value, [key]: JSON.parse(contents) }));
}

function inlineContents(value: unknown): string {
  return JSON.stringify(value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {});
}

function valueLabel(value: unknown): string {
  if (
    typeof props.valueType === 'string' ||
    props.valueType.type !== 'object' ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return 'Value';
  }
  const object = value as Record<string, unknown>;
  const parts = Object.entries(props.valueType.properties ?? {}).flatMap(([name, definition]) => {
    const current = object[name];
    if (current === undefined || current === null || current === '' || typeof current === 'object') {
      return [];
    }
    let display = String(current);
    if (typeof definition !== 'string') {
      if (definition.type === 'registry' && definition.registry) {
        display =
          props.registryOptions[definition.registry]?.find((option) => option.value === current)?.label ?? display;
      } else if (definition.type === 'enum') {
        display = definition.values?.find((option) => option.value === current)?.label ?? display;
      }
    }
    const label = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (character) => character.toUpperCase());
    return [`${label}: ${display}`];
  });
  return parts.join(' · ') || 'Value';
}
</script>

<template>
  <div class="map">
    <div v-for="(value, key) in entries" :key="key" class="entry">
      <div class="entry-heading">
        <span class="entry-key" :title="key">
          <RegistryVisual v-if="entryOption(key)?.visual" :identifier="entryOption(key)!.visual!" />
          <span>{{ entryLabel(key) }}</span>
        </span>
        <button type="button" :aria-label="`Remove ${key}`" @click="remove(key)">Remove</button>
      </div>
      <SchemaForm
        v-if="inlineProperties"
        class="inline-value"
        :schema="inlineProperties"
        :contents="inlineContents(value)"
        :registry-options="registryOptions"
        @update-contents="updateInlineEntry(key, $event)"
        @search-registry="(registry, query, lookup) => emit('searchRegistry', registry, query, lookup)"
        @pick-coordinate="emit('pickCoordinate', `${key}.${$event}`)"
        @pick-distance="emit('pickDistance', { ...$event, field: `${key}.${$event.field}` })"
      />
      <SchemaForm
        v-else
        :schema="{ value: valueType }"
        :field-labels="{ value: valueLabel(value) }"
        :contents="JSON.stringify({ value })"
        :registry-options="registryOptions"
        @update-contents="updateEntry(key, $event)"
        @search-registry="(registry, query, lookup) => emit('searchRegistry', registry, query, lookup)"
        @pick-coordinate="emit('pickCoordinate', `${key}${$event === 'value' ? '' : $event.slice(5)}`)"
        @pick-distance="
          emit('pickDistance', { ...$event, field: `${key}${$event.field === 'value' ? '' : $event.field.slice(5)}` })
        "
      />
    </div>
    <div class="add-entry">
      <SchemaForm
        :key="contents"
        :schema="{ key: keyType }"
        :contents="draft"
        :registry-options="registryOptions"
        @update-contents="draft = $event"
        @search-registry="(registry, query, lookup) => emit('searchRegistry', registry, query, lookup)"
      />
      <button type="button" :disabled="!selectedKey || duplicate" @click="add">Add entry</button>
    </div>
    <small v-if="duplicate" role="status">This key already exists.</small>
  </div>
</template>

<style scoped>
.map {
  display: grid;
  gap: 12px;
}
.entry {
  border: 1px solid #3f3f46;
  border-radius: 6px;
  overflow: visible;
}
.entry-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  overflow-wrap: anywhere;
}
.inline-value {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  overflow: visible;
  padding: 12px;
}
.entry-key {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.add-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}
button {
  padding: 8px 12px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  color: #fafafa;
  background: #18181b;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
small {
  color: #fda4af;
}
</style>
