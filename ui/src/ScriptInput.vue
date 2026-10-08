<script setup lang="ts">
import { ref, useId, watch } from 'vue';
import { useSelene } from './selene';

const props = defineProps<{ value: string; required: boolean }>();
const emit = defineEmits<{ select: [value: string] }>();
const selene = useSelene();
const id = useId();
const open = ref(false);
const query = ref(props.value);
const options = ref<string[]>([]);
const loading = ref(false);
const error = ref('');
const active = ref(-1);
const searchRequest = ref<{ query: string } | null>(null);

watch(
  () => props.value,
  (value) => {
    query.value = value;
  },
);
watch(
  searchRequest,
  async (request, _, onCleanup) => {
    if (!request) {
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      cancelled = true;
      loading.value = false;
      error.value = 'Script search timed out. Focus the field or edit the search to retry.';
    }, 10000);
    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timeout);
    });

    try {
      const result = (await selene.http.request('/scripts', request)) as { options: string[] };
      if (!cancelled) {
        options.value = result.options;
      }
    } catch (reason: unknown) {
      if (!cancelled) {
        error.value = reason instanceof Error ? reason.message : String(reason);
      }
    } finally {
      window.clearTimeout(timeout);
      if (!cancelled) {
        loading.value = false;
      }
    }
  },
  { flush: 'sync' },
);

function search(value: string): void {
  query.value = value;
  open.value = true;
  loading.value = true;
  error.value = '';
  options.value = [];
  active.value = -1;
  searchRequest.value = { query: value };
}

function close(): void {
  searchRequest.value = null;
  loading.value = false;
  open.value = false;
  query.value = props.value;
}

function select(value: string): void {
  emit('select', value);
  close();
  query.value = value;
}

function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!open.value) {
      search(props.value);
    }
    if (options.value.length) {
      active.value =
        (active.value + (event.key === 'ArrowDown' ? 1 : -1) + options.value.length) % options.value.length;
    }
  } else if (event.key === 'Enter' && open.value) {
    event.preventDefault();
    const value = options.value[active.value];
    if (value !== undefined) {
      select(value);
    }
  }
}
</script>

<template>
  <div class="script-input">
    <input
      :value="query"
      type="text"
      role="combobox"
      autocomplete="off"
      :required="required"
      :aria-expanded="open"
      :aria-controls="id"
      :aria-activedescendant="active >= 0 ? `${id}-${active}` : undefined"
      aria-autocomplete="list"
      placeholder="Search Lua scripts…"
      @focus="search(value)"
      @input="search(($event.target as HTMLInputElement).value)"
      @blur="close"
      @keydown="keydown"
    />
    <div v-if="open" :id="id" class="options" role="listbox">
      <button
        v-for="(option, index) in options"
        :id="`${id}-${index}`"
        :key="option"
        type="button"
        role="option"
        :aria-selected="value === option"
        :class="{ active: active === index }"
        @mousedown.prevent
        @click="select(option)"
      >
        {{ option }}
      </button>
      <p v-if="!options.length" role="status">{{ loading ? 'Loading scripts…' : error || 'No matching scripts.' }}</p>
    </div>
  </div>
</template>

<style scoped>
.script-input {
  position: relative;
  min-width: 0;
}
input {
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
input:focus {
  border-color: #fb7185;
  box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.14);
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
button {
  display: block;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: 5px;
  color: #e4e4e7;
  background: transparent;
  font: inherit;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
button:hover,
button.active,
button[aria-selected='true'] {
  background: rgba(251, 113, 133, 0.14);
}
p {
  margin: 8px;
  color: #71717a;
}
</style>
