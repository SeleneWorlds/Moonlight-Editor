<script setup lang="ts">
import { computed } from 'vue';
import { defaultSchemaValue, type DistancePick, type SchemaDefinition } from './schema';
import SchemaForm from './SchemaForm.vue';

const props = defineProps<{
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
const entries = computed<unknown[]>(() => JSON.parse(props.contents));

function update(index: number, contents: string): void {
  const next = [...entries.value];
  next[index] = JSON.parse(contents).value;
  emit('updateContents', JSON.stringify(next));
}

function remove(index: number): void {
  emit('updateContents', JSON.stringify(entries.value.filter((_, current) => current !== index)));
}

function add(): void {
  emit('updateContents', JSON.stringify([...entries.value, defaultSchemaValue(props.valueType)]));
}
</script>

<template>
  <div class="array">
    <div v-for="(value, index) in entries" :key="index" class="entry">
      <div class="entry-heading">
        <span>Entry {{ index + 1 }}</span>
        <button type="button" :aria-label="`Remove entry ${index + 1}`" @click="remove(index)">Remove</button>
      </div>
      <SchemaForm
        :schema="{ value: valueType }"
        :contents="JSON.stringify({ value })"
        :registry-options="registryOptions"
        @update-contents="update(index, $event)"
        @search-registry="(registry, query, lookup) => emit('searchRegistry', registry, query, lookup)"
        @pick-coordinate="emit('pickCoordinate', `${index}${$event === 'value' ? '' : $event.slice(5)}`)"
        @pick-distance="
          emit('pickDistance', { ...$event, field: `${index}${$event.field === 'value' ? '' : $event.field.slice(5)}` })
        "
      />
    </div>
    <button type="button" @click="add">Add entry</button>
  </div>
</template>

<style scoped>
.array {
  display: grid;
  gap: 12px;
}
.entry {
  border: 1px solid #3f3f46;
  border-radius: 6px;
}
.entry-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
}
button {
  padding: 8px 12px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  color: #fafafa;
  background: #18181b;
  cursor: pointer;
}
</style>
