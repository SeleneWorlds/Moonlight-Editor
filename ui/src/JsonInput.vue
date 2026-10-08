<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{ value: unknown; readonly?: boolean }>();
const emit = defineEmits<{ updateValue: [value: unknown] }>();
const draft = ref('');
const invalid = ref(false);
watch(
  () => props.value,
  (value) => {
    draft.value = JSON.stringify(value ?? null, null, 2);
    invalid.value = false;
  },
  { immediate: true },
);

function update(event: Event): void {
  if (props.readonly) {
    return;
  }
  draft.value = (event.target as HTMLTextAreaElement).value;
  try {
    const value: unknown = JSON.parse(draft.value);
    invalid.value = false;
    emit('updateValue', value);
  } catch {
    invalid.value = true;
  }
}
</script>

<template>
  <div class="json-input">
    <textarea :readonly="readonly" :value="draft" :aria-invalid="invalid" rows="4" @input="update" />
    <small v-if="invalid" role="status">Enter a valid JSON value.</small>
  </div>
</template>

<style scoped>
textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 8px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  color: #fafafa;
  background: #18181b;
  font-family: monospace;
  resize: vertical;
}
small {
  color: #fda4af;
}
</style>
