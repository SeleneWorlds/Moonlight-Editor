<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ExternalLink, Eye, Locate, Radius } from '@lucide/vue';
import type { DistancePick, SchemaDefinition } from './schema';
import { useSelene, type Coordinate } from './selene';
import RegistryVisual from './RegistryVisual.vue';
import SchemaMap from './SchemaMap.vue';
import SchemaArray from './SchemaArray.vue';
import JsonInput from './JsonInput.vue';
import ScriptInput from './ScriptInput.vue';
import RangeInput from './RangeInput.vue';

type JsonObject = Record<string, unknown>;
type RegistryOption = { value: string; label: string; visual?: string };

const props = defineProps<{
  schema: Record<string, SchemaDefinition>;
  contents: string;
  registryOptions: Record<string, RegistryOption[]>;
  fieldLabels?: Record<string, string>;
}>();
const emit = defineEmits<{
  updateContents: [contents: string];
  searchRegistry: [registry: string, query: string, lookup?: boolean];
  pickCoordinate: [field: string];
  pickDistance: [pick: DistancePick];
}>();

const selene = useSelene();

const parsed = computed(() => {
  try {
    const value: unknown = JSON.parse(props.contents);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
  } catch {
    return null;
  }
});
const fields = computed(() =>
  Object.entries(props.schema)
    .map(([name, definition]) => ({
      name,
      ...(typeof definition === 'string' ? { type: definition, optional: false } : definition),
    }))
    .sort(
      (a, b) =>
        Number(['object', 'map', 'array'].includes(a.type)) - Number(['object', 'map', 'array'].includes(b.type)),
    ),
);
const openRegistryField = ref<string | null>(null);
const registryQueries = reactive<Record<string, string>>({});
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
  () => fields.value.map((field) => ({ ...field, value: parsed.value?.[field.name] })),
  (currentFields) => {
    for (const field of currentFields) {
      if (
        field.type === 'registry' &&
        field.registry &&
        typeof field.value === 'string' &&
        field.value &&
        !selectedRegistryOption(field.name, field.registry)
      ) {
        emit('searchRegistry', field.registry, field.value, true);
      }
    }
  },
  { immediate: true },
);

function label(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (value) => value.toUpperCase());
}

function update(name: string, value: unknown): void {
  if (!parsed.value) {
    return;
  }
  emit('updateContents', `${JSON.stringify({ ...parsed.value, [name]: value }, null, 2)}\n`);
}

function remove(name: string): void {
  if (!parsed.value) {
    return;
  }
  const next = { ...parsed.value };
  delete next[name];
  emit('updateContents', `${JSON.stringify(next, null, 2)}\n`);
}

function objectContents(name: string): string {
  const value = parsed.value?.[name];
  const object = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return JSON.stringify(object);
}

function updateObject(name: string, contents: string): void {
  update(name, JSON.parse(contents));
}

function arrayContents(name: string): string {
  const value = parsed.value?.[name];
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function numberValue(name: string, event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.value !== '') {
    update(name, Number(input.value));
  }
}

function distancePick(field: { name: string; coordinate?: string; min?: number; max?: number }): DistancePick | null {
  const center = field.coordinate?.split('.').reduce<unknown>((value, key) => {
    return value !== null && typeof value === 'object' ? (value as JsonObject)[key] : undefined;
  }, parsed.value);
  if (!center || typeof center !== 'object') {
    return null;
  }
  const coordinate = center as JsonObject;
  if (![coordinate.x, coordinate.y, coordinate.z].every((axis) => typeof axis === 'number' && Number.isFinite(axis))) {
    return null;
  }
  return {
    field: field.name,
    coordinate: { x: coordinate.x as number, y: coordinate.y as number, z: coordinate.z as number },
    distance: Math.max(0, field.min ?? 0, Math.min(field.max ?? Infinity, Number(parsed.value?.[field.name]) || 0)),
    min: field.min,
    max: field.max,
  };
}

function previewDistance(field: Parameters<typeof distancePick>[0]): void {
  const pick = distancePick(field);
  if (pick) {
    emit('pickDistance', pick);
  }
}

function coordinateValue(name: string, axis: 'x' | 'y' | 'z'): number | undefined {
  const coordinate = parsed.value?.[name];
  return coordinate !== null && typeof coordinate === 'object' && !Array.isArray(coordinate)
    ? ((coordinate as JsonObject)[axis] as number | undefined)
    : undefined;
}

function cameraCoordinate(name: string): Coordinate | null {
  const x = coordinateValue(name, 'x');
  const y = coordinateValue(name, 'y');
  const z = coordinateValue(name, 'z');
  if (![x, y, z].every((axis) => typeof axis === 'number' && Number.isInteger(axis) && Math.abs(axis) <= 2147483647)) {
    return null;
  }
  return { x: x!, y: y!, z: z! };
}

function viewCoordinate(name: string): void {
  const coordinate = cameraCoordinate(name);
  if (coordinate) {
    selene.network.sendToServer('moonlight-editor:move-camera', { ...coordinate });
  }
}

function updateCoordinate(name: string, axis: 'x' | 'y' | 'z', event: Event): void {
  const current = parsed.value?.[name];
  const coordinate = current !== null && typeof current === 'object' && !Array.isArray(current) ? current : {};
  update(name, { ...coordinate, [axis]: Number((event.target as HTMLInputElement).value) });
}

function rangeValue(name: string, bound: 'min' | 'max'): number | undefined {
  const range = parsed.value?.[name];
  return range !== null && typeof range === 'object' && !Array.isArray(range)
    ? ((range as JsonObject)[bound] as number | undefined)
    : undefined;
}

function openRegistry(name: string, registry: string): void {
  registryQueries[name] = selectedRegistryOption(name, registry)?.label ?? String(parsed.value?.[name] ?? '');
  openRegistryField.value = name;
  emit('searchRegistry', registry, registryQueries[name] ?? '');
}

function searchRegistry(name: string, registry: string, event: Event): void {
  const query = (event.target as HTMLInputElement).value;
  registryQueries[name] = query;
  openRegistryField.value = name;
  emit('searchRegistry', registry, query);
}

function selectedRegistryOption(name: string, registry: string): RegistryOption | undefined {
  const value = parsed.value?.[name];
  return typeof value === 'string' ? knownRegistryOptions[registry]?.[value] : undefined;
}

function openRegistryEntry(name: string, registry: string): void {
  const value = parsed.value?.[name];
  if (typeof value === 'string' && value) {
    openRegistryField.value = null;
    selene.network.sendToServer('moonlight-editor:open-registry-entry', { registry, value });
  }
}

function selectRegistry(name: string, option: RegistryOption): void {
  update(name, option.value);
  registryQueries[name] = option.label;
  openRegistryField.value = null;
}

function closeRegistry(name: string): void {
  window.setTimeout(() => {
    if (openRegistryField.value === name) {
      openRegistryField.value = null;
      registryQueries[name] =
        selectedRegistryOption(name, fields.value.find((field) => field.name === name)?.registry ?? '')?.label ??
        String(parsed.value?.[name] ?? '');
    }
  });
}
</script>

<template>
  <div v-if="parsed" class="schema-form">
    <component
      :is="['object', 'map', 'array'].includes(field.type) ? 'details' : 'label'"
      v-for="field in fields"
      :key="field.name"
      class="field"
      :class="{ coordinate: ['coordinate', 'range', 'object', 'map', 'array', 'any'].includes(field.type) }"
    >
      <component :is="['object', 'map', 'array'].includes(field.type) ? 'summary' : 'span'" class="heading">
        {{ fieldLabels?.[field.name] ?? label(field.name) }}
        <small v-if="field.optional">optional</small>
        <button v-if="field.optional && field.name in parsed" type="button" @click="remove(field.name)">Clear</button>
      </component>
      <SchemaMap
        v-if="field.type === 'map' && field.keyType && field.valueType"
        :key-type="field.keyType"
        :value-type="field.valueType"
        :contents="objectContents(field.name)"
        :registry-options="registryOptions"
        @update-contents="updateObject(field.name, $event)"
        @search-registry="(registry, query, lookup) => emit('searchRegistry', registry, query, lookup)"
        @pick-coordinate="emit('pickCoordinate', `${field.name}.${$event}`)"
        @pick-distance="emit('pickDistance', { ...$event, field: `${field.name}.${$event.field}` })"
      />
      <SchemaArray
        v-else-if="field.type === 'array' && field.valueType"
        :value-type="field.valueType"
        :contents="arrayContents(field.name)"
        :registry-options="registryOptions"
        @update-contents="updateObject(field.name, $event)"
        @search-registry="(registry, query, lookup) => emit('searchRegistry', registry, query, lookup)"
        @pick-coordinate="emit('pickCoordinate', `${field.name}.${$event}`)"
        @pick-distance="emit('pickDistance', { ...$event, field: `${field.name}.${$event.field}` })"
      />
      <JsonInput
        v-else-if="field.type === 'any'"
        :value="parsed[field.name]"
        @update-value="update(field.name, $event)"
      />
      <SchemaForm
        v-else-if="field.type === 'object' && field.properties"
        class="nested-form"
        :schema="field.properties"
        :contents="objectContents(field.name)"
        :registry-options="registryOptions"
        @update-contents="updateObject(field.name, $event)"
        @search-registry="(registry, query, lookup) => emit('searchRegistry', registry, query, lookup)"
        @pick-coordinate="emit('pickCoordinate', `${field.name}.${$event}`)"
        @pick-distance="emit('pickDistance', { ...$event, field: `${field.name}.${$event.field}` })"
      />
      <div v-else-if="field.type === 'distance'" class="distance-input">
        <input
          :value="parsed[field.name] as number | undefined"
          type="number"
          step="1"
          :min="field.min ?? 0"
          :max="field.max"
          :required="!field.optional"
          @input="numberValue(field.name, $event)"
        />
        <button
          type="button"
          :disabled="!distancePick(field)"
          :aria-label="`Preview and pick ${label(field.name)} in the world`"
          :title="
            distancePick(field) ? 'Preview and pick distance in the world' : 'Set the referenced coordinate first'
          "
          @click="previewDistance(field)"
        >
          <Radius :size="16" aria-hidden="true" />
        </button>
      </div>
      <input
        v-else-if="field.type === 'integer' || field.type === 'number' || field.type === 'Direction'"
        :value="parsed[field.name] as number | undefined"
        type="number"
        :step="field.type === 'number' ? 'any' : 1"
        :required="!field.optional"
        @input="numberValue(field.name, $event)"
      />
      <input
        v-else-if="field.type === 'string'"
        :value="parsed[field.name] as string | undefined"
        type="text"
        :required="!field.optional"
        @input="update(field.name, ($event.target as HTMLInputElement).value)"
      />
      <ScriptInput
        v-else-if="field.type === 'script'"
        :value="String(parsed[field.name] ?? '')"
        :required="!field.optional"
        @select="update(field.name, $event)"
      />
      <input
        v-else-if="field.type === 'boolean' || field.type === 'enabled'"
        :checked="parsed[field.name] === true"
        class="checkbox"
        type="checkbox"
        @change="update(field.name, ($event.target as HTMLInputElement).checked)"
      />
      <select
        v-else-if="field.type === 'enum'"
        :value="parsed[field.name]"
        :required="!field.optional"
        @change="
          update(
            field.name,
            field.values?.[($event.target as HTMLSelectElement).selectedIndex - (field.optional ? 1 : 0)]?.value,
          )
        "
      >
        <option v-if="field.optional" :value="undefined">None</option>
        <option v-for="option in field.values" :key="String(option.value)" :value="option.value">
          {{ option.label }}
        </option>
      </select>
      <RangeInput
        v-else-if="field.type === 'range'"
        :minimum="field.min"
        :maximum="field.max"
        :lower="rangeValue(field.name, 'min')"
        :upper="rangeValue(field.name, 'max')"
        :required="!field.optional"
        :label="label(field.name)"
        @update="update(field.name, { ...JSON.parse(objectContents(field.name)), ...$event })"
      />
      <div v-else-if="field.type === 'coordinate'" class="coordinate-input">
        <label v-for="axis in ['x', 'y', 'z'] as const" :key="axis">
          <span>{{ axis.toUpperCase() }}</span>
          <input
            :value="coordinateValue(field.name, axis)"
            type="number"
            step="1"
            @input="updateCoordinate(field.name, axis, $event)"
          />
        </label>
        <button
          type="button"
          class="pick-coordinate"
          :aria-label="`Pick ${label(field.name)} from world`"
          title="Pick coordinate from world"
          @click="emit('pickCoordinate', field.name)"
        >
          <Locate :size="16" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="view-coordinate"
          :aria-label="`Move camera to ${label(field.name)}`"
          title="Move camera to coordinate"
          :disabled="!cameraCoordinate(field.name)"
          @click="viewCoordinate(field.name)"
        >
          <Eye :size="16" aria-hidden="true" />
        </button>
      </div>
      <div v-else-if="field.type === 'registry' && field.registry" class="registry-input">
        <div
          class="registry-control"
          :class="{ 'has-visual': selectedRegistryOption(field.name, field.registry)?.visual }"
        >
          <RegistryVisual
            v-if="selectedRegistryOption(field.name, field.registry)?.visual"
            class="selected-visual"
            :identifier="selectedRegistryOption(field.name, field.registry)!.visual!"
          />
          <input
            :value="
              registryQueries[field.name] ??
              selectedRegistryOption(field.name, field.registry)?.label ??
              parsed[field.name]
            "
            type="text"
            role="combobox"
            autocomplete="off"
            :required="!field.optional"
            :aria-expanded="openRegistryField === field.name"
            :aria-controls="`registry-${field.name}`"
            placeholder="Search registry…"
            @focus="openRegistry(field.name, field.registry)"
            @input="searchRegistry(field.name, field.registry, $event)"
            @blur="closeRegistry(field.name)"
          />
          <button
            type="button"
            class="open-registry-entry"
            :disabled="typeof parsed[field.name] !== 'string' || !parsed[field.name]"
            :aria-label="`Open ${label(field.name)} registry entry in the form`"
            title="Open registry entry in the form"
            @click="openRegistryEntry(field.name, field.registry)"
          >
            <ExternalLink :size="16" aria-hidden="true" />
          </button>
        </div>
        <div v-if="openRegistryField === field.name" :id="`registry-${field.name}`" class="options" role="listbox">
          <button
            v-for="option in registryOptions[field.registry] ?? []"
            :key="option.value"
            type="button"
            role="option"
            :aria-selected="parsed[field.name] === option.value"
            @mousedown.prevent
            @click="selectRegistry(field.name, option)"
          >
            <RegistryVisual v-if="option.visual" :identifier="option.visual" />
            <span class="option-text"
              ><strong>{{ option.label }}</strong
              ><small>{{ option.value }}</small></span
            >
          </button>
          <p v-if="(registryOptions[field.registry] ?? []).length === 0">No matching entries.</p>
        </div>
      </div>
      <input
        v-else
        :value="String(parsed[field.name] ?? '')"
        type="text"
        :required="!field.optional"
        @input="update(field.name, ($event.target as HTMLInputElement).value)"
      />
    </component>
  </div>
  <div v-else class="invalid">Fix the JSON in the Raw JSON tab before using the form.</div>
</template>

<style scoped>
.schema-form {
  min-height: 0;
  padding: 18px;
  overflow: visible;
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  gap: 16px;
  align-content: start;
  background: #09090b;
}
.field {
  display: grid;
  gap: 6px;
  min-width: 0;
  color: #d4d4d8;
}
.field.coordinate {
  grid-column: 1 / -1;
}
.nested-form {
  overflow: visible;
  padding: 12px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
}
.heading {
  display: flex;
  align-items: baseline;
  gap: 7px;
  font-weight: 650;
}
.heading small {
  color: #71717a;
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
}
.heading button {
  margin-left: auto;
  padding: 0;
  border: 0;
  color: #fda4af;
  background: none;
  cursor: pointer;
}
details.field > summary {
  cursor: pointer;
  list-style: none;
}
details.field > summary::before {
  content: '▸';
  color: #a1a1aa;
}
details.field[open] > summary::before {
  content: '▾';
}
details.field[open] > summary {
  margin-bottom: 6px;
}
details.field > summary::-webkit-details-marker {
  display: none;
}
input,
select {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 9px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  outline: none;
  color: #fafafa;
  background: #18181b;
  font: inherit;
}
input:focus,
select:focus {
  border-color: #fb7185;
  box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.14);
}
.distance-input {
  display: flex;
  gap: 8px;
}
.distance-input button {
  display: grid;
  place-items: center;
  padding: 8px 12px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  color: #fafafa;
  background: #18181b;
  cursor: pointer;
}
.distance-input button:disabled {
  opacity: 0.5;
  cursor: default;
}
.checkbox {
  width: 18px;
  height: 18px;
  accent-color: #fb7185;
}
.coordinate-input,
.range-input {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto auto;
  gap: 10px;
}
.range-input {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.pick-coordinate,
.view-coordinate {
  display: grid;
  place-items: center;
  align-self: end;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid rgba(251, 113, 133, 0.42);
  border-radius: 6px;
  color: #ffe4e6;
  background: rgba(251, 113, 133, 0.14);
  cursor: pointer;
}
.pick-coordinate:hover,
.pick-coordinate:focus-visible,
.view-coordinate:hover:not(:disabled),
.view-coordinate:focus-visible {
  outline: none;
  background: rgba(251, 113, 133, 0.24);
}
.view-coordinate:disabled {
  opacity: 0.4;
  cursor: default;
}
.coordinate-input label,
.range-input label {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 6px;
  color: #71717a;
}
.registry-input {
  position: relative;
  min-width: 0;
}
.registry-control {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}
.registry-control input {
  min-width: 0;
}
.open-registry-entry {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid rgba(251, 113, 133, 0.42);
  border-radius: 6px;
  color: #ffe4e6;
  background: rgba(251, 113, 133, 0.14);
  cursor: pointer;
}
.open-registry-entry:hover:not(:disabled),
.open-registry-entry:focus-visible {
  background: rgba(251, 113, 133, 0.24);
}
.open-registry-entry:disabled {
  opacity: 0.4;
  cursor: default;
}
.registry-control.has-visual input {
  min-height: 54px;
  padding-left: 62px;
}
.selected-visual {
  position: absolute;
  top: 50%;
  left: 5px;
  transform: translateY(-50%);
}
.options {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  max-height: 270px;
  overflow: auto;
  padding: 4px;
  border: 1px solid #3f3f46;
  border-radius: 7px;
  background: #18181b;
  box-shadow: 0 12px 30px #000a;
}
.options button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 5px;
  border: 0;
  border-radius: 5px;
  color: #e4e4e7;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.options button:hover,
.options button[aria-selected='true'] {
  background: rgba(251, 113, 133, 0.14);
}
.option-text {
  min-width: 0;
  display: grid;
}
.option-text strong,
.option-text small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.option-text small {
  color: #71717a;
  font-size: 10px;
}
.options p {
  margin: 8px;
  color: #71717a;
}
.invalid {
  display: grid;
  place-items: center;
  color: #f87171;
  background: #09090b;
}
@media (max-width: 800px) {
  .schema-form {
    grid-template-columns: 1fr;
  }
  .field.coordinate {
    grid-column: auto;
  }
}
</style>
