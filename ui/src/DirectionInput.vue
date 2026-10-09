<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId } from 'vue';
import {
  ArrowUp,
  ArrowUpRight,
  ArrowRight,
  ArrowDownRight,
  ArrowDown,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpLeft,
  ChevronDown,
} from '@lucide/vue';
import { useSelene, type Coordinate } from './selene';
import { projectedDirectionAngle } from './direction';

const props = defineProps<{ value?: string; readonly?: boolean }>();
const emit = defineEmits<{ select: [name: string] }>();
const selene = useSelene();
const directions = ref<Array<{ name: string; angle: number; vector: Coordinate }>>([]);
const ready = ref(false);
const disposers: Array<() => void> = [];
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const open = ref(false);
const popupId = useId();
const selected = computed(() => directions.value.find((direction) => direction.name === props.value));
const cells = [2, 3, 6, 9, 8, 7, 4, 1];
const arrows = [ArrowUp, ArrowUpRight, ArrowRight, ArrowDownRight, ArrowDown, ArrowDownLeft, ArrowLeft, ArrowUpLeft];
const projectedAngles = computed(() =>
  directions.value.map((direction) => projectedDirectionAngle(direction.vector, selene.world.projectCoordinate)),
);
const slots = computed(() => projectedAngles.value.map((angle) => Math.round(angle / 45) % 8));
const selectedArrow = computed(
  () => arrows[slots.value[directions.value.findIndex((direction) => direction.name === props.value)]!],
);
const usePad = computed(() => directions.value.length <= 8 && new Set(slots.value).size === slots.value.length);

function select(name: string): void {
  if (props.readonly) {
    return;
  }
  emit('select', name);
  open.value = false;
  trigger.value?.focus();
}
function closeOutside(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) {
    open.value = false;
  }
}
function closeOnBlur(event: FocusEvent): void {
  if (!root.value?.contains(event.relatedTarget as Node | null)) {
    open.value = false;
  }
}
function escape(): void {
  open.value = false;
  trigger.value?.focus();
}

onMounted(() => {
  document.addEventListener('pointerdown', closeOutside);
  disposers.push(
    selene.network.onPayload('moonlight-editor:directions', (payload) => {
      directions.value = (Array.isArray(payload.directions) ? payload.directions : []).filter(
        (direction): direction is { name: string; angle: number; vector: Coordinate } =>
          direction !== null &&
          typeof direction === 'object' &&
          typeof direction.name === 'string' &&
          typeof direction.angle === 'number' &&
          Number.isFinite(direction.angle) &&
          direction.vector !== null &&
          typeof direction.vector === 'object' &&
          [direction.vector.x, direction.vector.y, direction.vector.z].every(
            (axis) => typeof axis === 'number' && Number.isFinite(axis),
          ),
      );
      ready.value = true;
    }),
  );
  disposers.push(
    selene.network.onConnected(() => {
      selene.network.sendToServer('moonlight-editor:request-directions');
    }),
  );
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', closeOutside);
  disposers.forEach((dispose) => dispose());
});
</script>

<template>
  <!-- Keep internal pointer events inside the closed editor shadow root. Otherwise
       document listeners see the editor host and close the popup before click. -->
  <div ref="root" class="direction-input" @pointerdown.stop @focusout="closeOnBlur" @keydown.esc.stop.prevent="escape">
    <select
      v-if="!usePad"
      :value="value ?? ''"
      :disabled="readonly"
      aria-label="Direction"
      @change="select(($event.target as HTMLSelectElement).value)"
    >
      <option value="" disabled>Select direction…</option>
      <option v-if="value && !selected" :value="value" disabled>Unknown direction: {{ value }}</option>
      <option v-for="direction in directions" :key="direction.name" :value="direction.name">
        {{ direction.name }}
      </option>
    </select>
    <template v-else>
      <button
        ref="trigger"
        type="button"
        class="trigger"
        :disabled="readonly || !directions.length"
        :aria-expanded="open"
        :aria-controls="popupId"
        @click="open = !open"
      >
        <component :is="selectedArrow" v-if="selected" :size="18" aria-hidden="true" />
        <span>{{ selected?.name ?? (value ? `Unknown direction: ${value}` : 'Select direction…') }}</span>
        <ChevronDown :size="16" aria-hidden="true" />
      </button>
      <div v-if="open" :id="popupId" class="popup" role="group" aria-label="Select direction">
        <div class="pad">
          <span class="center" aria-hidden="true">•</span>
          <button
            v-for="(direction, index) in directions"
            :key="direction.name"
            type="button"
            class="direction"
            :style="{
              gridArea: `${Math.floor((cells[slots[index]!]! - 1) / 3) + 1} / ${((cells[slots[index]!]! - 1) % 3) + 1}`,
            }"
            :aria-pressed="value === direction.name"
            :title="direction.name"
            @click="select(direction.name)"
          >
            <component :is="arrows[slots[index]!]" :size="22" aria-hidden="true" />
            <span>{{ direction.name }}</span>
          </button>
        </div>
      </div>
    </template>
    <small v-if="!directions.length">{{
      ready ? 'No directions defined in the active grid' : 'Loading grid directions…'
    }}</small>
  </div>
</template>

<style scoped>
.direction-input {
  position: relative;
  min-width: 0;
}
button,
select {
  padding: 8px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #18181b;
  color: #e4e4e7;
  cursor: pointer;
}
.trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
}
.trigger span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trigger svg {
  flex-shrink: 0;
}
select {
  width: 100%;
}
.popup {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid #3f3f46;
  border-radius: 8px;
  background: #18181b;
  box-shadow: 0 12px 30px #000a;
}
.pad {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(3, 64px);
  gap: 6px;
}
.center {
  grid-area: 2 / 2;
  align-self: center;
  justify-self: center;
  color: #71717a;
  font-size: 24px;
}
.direction {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  padding: 4px;
}
.direction span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}
button:hover {
  background: #27272a;
}
button[aria-pressed='true'] {
  border-color: #fb7185;
  background: rgba(251, 113, 133, 0.14);
}
button:focus-visible,
select:focus-visible {
  outline: 2px solid #fb7185;
  outline-offset: 2px;
}
button:disabled,
select:disabled {
  cursor: default;
  opacity: 0.6;
}
small {
  display: block;
  margin-top: 6px;
  color: #a1a1aa;
}
</style>
