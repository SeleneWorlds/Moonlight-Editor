<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { MousePointer, Square, Circle, Plus, Minus, ChevronUp, ChevronDown } from '@lucide/vue';
import { useSelene } from './selene';
import { containsShape, parseArea, resizeShape, type ResizeHandle, type Area, type AreaShape } from './area';
const props = defineProps<{ value: unknown; readonly?: boolean }>();
const emit = defineEmits<{ updateValue: [value: Area] }>();
const selene = useSelene();
const dialog = ref<HTMLDialogElement>();
const canvas = ref<HTMLCanvasElement>();
const viewport = ref<HTMLDivElement>();
const panning = ref(false);
let pan: { pointerId: number; x: number; y: number; left: number; top: number } | undefined;
const draft = ref<Area>({ include: [], exclude: [] });
const group = ref<'include' | 'exclude'>('include');
const tool = ref<'rectangle' | 'circle'>('rectangle');
const cursorMode = ref(true);
let resizing: { pointerId: number; handle: ResizeHandle; original: AreaShape } | undefined;
const drawingModes = [
  { group: 'include', shape: 'rectangle', label: 'Add Rectangle' },
  { group: 'include', shape: 'circle', label: 'Add Circle' },
  { group: 'exclude', shape: 'rectangle', label: 'Exclude Rectangle' },
  { group: 'exclude', shape: 'circle', label: 'Exclude Circle' },
] as const;

const z = ref(0);
const floorText = ref('0');
const zoom = ref(1);
const loading = ref(false);
const error = ref('');
interface Overview {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  floors: number[];
  image: string;
}
const map = ref<Overview>();
const floors = ref<number[]>([]);
const floorAbove = computed(() => floors.value.find((floor) => floor > z.value));
const floorBelow = computed(() => [...floors.value].reverse().find((floor) => floor < z.value));
let image: HTMLImageElement | undefined;
let generation = 0;
let release: (() => void) | undefined;
let start: { x: number; y: number } | undefined;
const pending = ref<AreaShape>();
const movingShape = ref(false);
let moving:
  | {
      pointerId: number;
      x: number;
      y: number;
      original: AreaShape;
      selection: { group: 'include' | 'exclude'; index: number };
    }
  | undefined;
function beginMove(e: PointerEvent, p: { x: number; y: number }): void {
  if (props.readonly || !shape.value || !selected.value) {
    return;
  }
  moving = { pointerId: e.pointerId, ...p, original: { ...shape.value }, selection: { ...selected.value } };
  movingShape.value = true;
  canvas.value?.setPointerCapture(e.pointerId);
}
function cancelMove(): void {
  if (moving) {
    draft.value[moving.selection.group][moving.selection.index] = moving.original;
  }
  moving = undefined;
  movingShape.value = false;
  redraw();
}
const selected = ref<{ group: 'include' | 'exclude'; index: number }>();
const shape = computed(() => (selected.value ? draft.value[selected.value.group][selected.value.index] : undefined));
const shapeFields = computed(() => Object.entries(shape.value ?? {}).filter(([key]) => key !== 'type'));
const handles = computed(() => {
  const s = shape.value;
  if (!s || !map.value || s.z !== map.value.z || !cursorMode.value || props.readonly) {
    return [];
  }
  if (s.type === 'circle') {
    return [
      { key: 'n' as const, x: s.x, y: s.y - s.radius },
      { key: 'e' as const, x: s.x + s.radius, y: s.y },
      { key: 's' as const, x: s.x, y: s.y + s.radius },
      { key: 'w' as const, x: s.x - s.radius, y: s.y },
    ];
  }
  return [
    { key: 'nw' as const, x: s.x, y: s.y },
    { key: 'ne' as const, x: s.x + s.width - 1, y: s.y },
    { key: 'sw' as const, x: s.x, y: s.y + s.height - 1 },
    { key: 'se' as const, x: s.x + s.width - 1, y: s.y + s.height - 1 },
  ];
});
function beginResize(e: PointerEvent, handle: ResizeHandle): void {
  if (props.readonly || e.button !== 0 || !shape.value || pan || start || moving) {
    return;
  }
  resizing = { pointerId: e.pointerId, handle, original: { ...shape.value } };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function moveResize(e: PointerEvent): void {
  if (!resizing || resizing.pointerId !== e.pointerId || !selected.value) {
    return;
  }
  const p = point(e);
  draft.value[selected.value.group][selected.value.index] = resizeShape(resizing.original, resizing.handle, p.x, p.y);
  redraw();
}
function endResize(e: PointerEvent): void {
  if (!resizing || resizing.pointerId !== e.pointerId || e.button !== 0) {
    return;
  }
  moveResize(e);
  resizing = undefined;
}
function cancelResize(): void {
  if (resizing && selected.value) {
    draft.value[selected.value.group][selected.value.index] = resizing.original;
  }
  resizing = undefined;
  redraw();
}
function selectShape(group: 'include' | 'exclude', index: number): void {
  selected.value = { group, index };
  cursorMode.value = true;
  redraw();
}
const summary = computed(() => {
  try {
    const a = parseArea(props.value);
    return `${a.include.length} includes, ${a.exclude.length} excludes`;
  } catch {
    return 'Invalid area';
  }
});
async function open(): Promise<void> {
  if (dialog.value?.open) {
    return;
  }
  error.value = '';
  try {
    draft.value = parseArea(props.value);
  } catch (e) {
    error.value = String(e);
    return;
  }
  selected.value = undefined;
  floors.value = [];
  cursorMode.value = true;
  z.value = selene.world.getCameraCoordinate().z;
  floorText.value = String(z.value);
  release = selene.input.captureText();
  dialog.value?.showModal();
  await load();
}
function close(): void {
  generation++;
  endPan();
  cancelResize();
  cancelMove();
  start = undefined;
  pending.value = undefined;
  release?.();
  release = undefined;
}
onBeforeUnmount(close);
function commitFloor(): void {
  const text = floorText.value.trim();
  const floor = Number(text);
  if (!/^-?\d+$/.test(text) || !Number.isInteger(floor) || Math.abs(floor) > 2147483647) {
    floorText.value = String(z.value);
    return;
  }
  floorText.value = String(floor);
  if (floor !== z.value) {
    z.value = floor;
    void load();
  }
}
function stepFloor(delta: number): void {
  const floor = delta > 0 ? floorAbove.value : floorBelow.value;
  if (floor === undefined || loading.value) {
    return;
  }
  z.value = floor;
  floorText.value = String(floor);
  void load();
}
async function load(): Promise<void> {
  endPan();
  cancelResize();
  cancelMove();
  start = undefined;
  pending.value = undefined;
  const id = ++generation;
  loading.value = true;
  error.value = '';
  map.value = undefined;
  image = undefined;
  try {
    const overview = (await selene.http.request('/worldmap/image', { z: z.value, tiles: 'base' })) as Overview;
    const bitmap = new Image();
    bitmap.src = overview.image;
    await bitmap.decode();
    if (id !== generation) {
      return;
    }
    floors.value = [...new Set(overview.floors)].sort((a, b) => a - b);
    map.value = overview;
    image = bitmap;
    await nextTick();
    redraw();
  } catch (e) {
    if (id === generation) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    if (id === generation) {
      loading.value = false;
    }
  }
}
function redraw(): void {
  const m = map.value;
  const target = canvas.value;
  if (!m || !target || !image) {
    return;
  }
  target.width = m.width;
  target.height = m.height;
  const ctx = target.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.drawImage(image, 0, 0);
  const a: Area = { include: [...draft.value.include], exclude: [...draft.value.exclude] };
  if (pending.value) {
    a[group.value].push(pending.value);
  }
  const layer = document.createElement('canvas');
  layer.width = m.width;
  layer.height = m.height;
  const overlay = layer.getContext('2d');
  if (!overlay) {
    return;
  }
  overlay.fillStyle = '#4ade80';
  for (const key of ['include', 'exclude'] as const) {
    overlay.globalCompositeOperation = key === 'include' ? 'source-over' : 'destination-out';
    for (const s of a[key]) {
      if (s.z !== m.z) {
        continue;
      }
      if (s.type === 'rectangle') {
        overlay.fillRect(s.x - m.x, s.y - m.y, s.width, s.height);
      } else {
        // Fill integer tile centers exactly, without antialiasing circle boundaries.
        const first = Math.max(m.y, s.y - s.radius);
        const last = Math.min(m.y + m.height - 1, s.y + s.radius);
        for (let y = first; y <= last; y++) {
          const span = Math.floor(Math.sqrt(s.radius ** 2 - (y - s.y) ** 2));
          overlay.fillRect(s.x - span - m.x, y - m.y, span * 2 + 1, 1);
        }
      }
    }
  }
  ctx.globalAlpha = 0.51;
  ctx.drawImage(layer, 0, 0);
  ctx.globalAlpha = 1;
  for (const key of ['include', 'exclude'] as const) {
    draft.value[key].forEach((s, index) => {
      if (s.z !== m.z) {
        return;
      }
      ctx.strokeStyle =
        selected.value?.group === key && selected.value.index === index
          ? '#fff'
          : key === 'include'
            ? '#4ade80'
            : '#f87171';
      ctx.beginPath();
      if (s.type === 'rectangle') {
        ctx.rect(s.x - m.x, s.y - m.y, s.width, s.height);
      } else {
        ctx.arc(s.x - m.x + 0.5, s.y - m.y + 0.5, s.radius + 0.5, 0, Math.PI * 2);
      }
      ctx.stroke();
    });
  }
}
function wheel(event: WheelEvent): void {
  const pane = viewport.value;
  const target = canvas.value;
  if (!pane || !target || !map.value || pan || start || resizing || moving) {
    return;
  }
  const bounds = pane.getBoundingClientRect();
  const x = event.clientX - bounds.left - pane.clientLeft;
  const y = event.clientY - bounds.top - pane.clientTop;
  const oldZoom = zoom.value;
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.clientHeight : 1);
  const nextZoom = Math.max(0.125, Math.min(16, oldZoom * Math.exp(-delta * 0.002)));
  if (nextZoom === oldZoom) {
    return;
  }
  const left = ((pane.scrollLeft + x) * nextZoom) / oldZoom - x;
  const top = ((pane.scrollTop + y) * nextZoom) / oldZoom - y;
  zoom.value = nextZoom;
  // Resize immediately so consecutive wheel events use the updated scroll bounds.
  target.style.width = `${map.value.width * nextZoom}px`;
  target.style.height = `${map.value.height * nextZoom}px`;
  if (target.parentElement) {
    target.parentElement.style.width = target.style.width;
    target.parentElement.style.height = target.style.height;
  }
  pane.scrollLeft = left;
  pane.scrollTop = top;
  redraw();
}
function beginPan(event: PointerEvent): void {
  const pane = viewport.value;
  if (event.button !== 1 || !pane || !map.value || start || resizing || moving) {
    return;
  }
  event.preventDefault();
  pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: pane.scrollLeft, top: pane.scrollTop };
  panning.value = true;
  pane.setPointerCapture(event.pointerId);
}
function movePan(event: PointerEvent): void {
  if (!pan || pan.pointerId !== event.pointerId || !viewport.value) {
    return;
  }
  event.preventDefault();
  viewport.value.scrollLeft = pan.left - (event.clientX - pan.x);
  viewport.value.scrollTop = pan.top - (event.clientY - pan.y);
}
function endPan(event?: PointerEvent): void {
  if (!pan || (event && event.pointerId !== pan.pointerId)) {
    return;
  }
  if (viewport.value?.hasPointerCapture(pan.pointerId)) {
    viewport.value.releasePointerCapture(pan.pointerId);
  }
  pan = undefined;
  panning.value = false;
}
function point(e: PointerEvent): { x: number; y: number } {
  const b = canvas.value!.getBoundingClientRect();
  const m = map.value!;
  return {
    x: m.x + Math.max(0, Math.min(m.width - 1, Math.floor(((e.clientX - b.left) * m.width) / b.width))),
    y: m.y + Math.max(0, Math.min(m.height - 1, Math.floor(((e.clientY - b.top) * m.height) / b.height))),
  };
}
function down(e: PointerEvent): void {
  if (e.button !== 0 || !map.value || pan || resizing || moving) {
    return;
  }
  if (cursorMode.value) {
    const p = point(e);
    // A selected shape takes priority where include/exclude shapes overlap.
    if (shape.value && containsShape(shape.value, p.x, p.y, z.value)) {
      beginMove(e, p);
      return;
    }
    selected.value = undefined;
    for (const key of ['exclude', 'include'] as const) {
      for (let index = draft.value[key].length - 1; index >= 0; index--) {
        if (containsShape(draft.value[key][index]!, p.x, p.y, z.value)) {
          selectShape(key, index);
          beginMove(e, p);
          return;
        }
      }
    }
    redraw();
    return;
  }
  if (props.readonly) {
    return;
  }
  start = point(e);
  canvas.value?.setPointerCapture(e.pointerId);
  move(e);
}
function move(e: PointerEvent): void {
  if (moving && moving.pointerId === e.pointerId) {
    const p = point(e);
    draft.value[moving.selection.group][moving.selection.index] = {
      ...moving.original,
      x: moving.original.x + p.x - moving.x,
      y: moving.original.y + p.y - moving.y,
    };
    redraw();
    return;
  }
  if (!start) {
    return;
  }
  const end = point(e);
  pending.value =
    tool.value === 'rectangle'
      ? {
          type: 'rectangle',
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          z: z.value,
          width: Math.abs(end.x - start.x) + 1,
          height: Math.abs(end.y - start.y) + 1,
        }
      : { type: 'circle', ...start, z: z.value, radius: Math.round(Math.hypot(end.x - start.x, end.y - start.y)) };
  redraw();
}
function up(e: PointerEvent): void {
  if (e.button === 0 && moving?.pointerId === e.pointerId) {
    move(e);
    moving = undefined;
    movingShape.value = false;
    return;
  }
  if (e.button !== 0 || !start || !pending.value) {
    return;
  }
  move(e);
  draft.value[group.value].push(pending.value!);
  selected.value = { group: group.value, index: draft.value[group.value].length - 1 };
  start = undefined;
  pending.value = undefined;
  cursorMode.value = true;
  redraw();
}
function cancelDraw(): void {
  cancelMove();
  start = undefined;
  pending.value = undefined;
  redraw();
}
function edit(key: string, e: Event): void {
  if (!shape.value || props.readonly) {
    return;
  }
  const n = Number((e.target as HTMLInputElement).value);
  if (!Number.isSafeInteger(n) || (['width', 'height'].includes(key) && n < 1) || (key === 'radius' && n < 0)) {
    return;
  }
  Object.assign(shape.value, { [key]: n });
  redraw();
}
function remove(): void {
  if (!selected.value || props.readonly) {
    return;
  }
  draft.value[selected.value.group].splice(selected.value.index, 1);
  selected.value = undefined;
  redraw();
}
function apply(): void {
  if (!props.readonly) {
    emit('updateValue', parseArea(draft.value));
    dialog.value?.close();
  }
}
</script>
<template>
  <div class="area-input">
    <button class="picker-trigger" type="button" @click="open">Area Picker · {{ summary }}</button>
    <span v-if="error && !dialog?.open" role="alert">{{ error }}</span>
    <dialog
      ref="dialog"
      class="area-picker"
      aria-label="Area Picker"
      @close="close"
      @cancel="close"
      @keydown.esc.stop
      @click.stop
      @pointerdown.stop
      @pointerup.stop
    >
      <header>
        <h2>Area Picker</h2>
        <button class="secondary" type="button" @click="dialog?.close()">Close</button>
      </header>
      <div class="toolbar">
        <div class="floor-control">
          <div class="floor-buttons">
            <button
              class="secondary"
              type="button"
              aria-label="Floor up"
              title="Floor up"
              :disabled="loading || floorAbove === undefined"
              @click="stepFloor(1)"
            >
              <ChevronUp :size="16" aria-hidden="true" />
            </button>
            <input
              v-model="floorText"
              type="text"
              inputmode="numeric"
              aria-label="Floor"
              @change="commitFloor"
              @keydown.enter.prevent="commitFloor"
            />
            <button
              class="secondary"
              type="button"
              aria-label="Floor down"
              title="Floor down"
              :disabled="loading || floorBelow === undefined"
              @click="stepFloor(-1)"
            >
              <ChevronDown :size="16" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div class="drawing-modes" role="group" aria-label="Drawing mode">
          <button
            class="drawing-mode"
            type="button"
            aria-label="Cursor"
            title="Cursor"
            :aria-pressed="cursorMode"
            @click="
              cursorMode = true;
              redraw();
            "
          >
            <MousePointer :size="18" aria-hidden="true" />
          </button>
          <template v-for="mode in drawingModes" :key="mode.label">
            <span v-if="mode.shape === 'rectangle'" class="mode-separator" aria-hidden="true" />
            <button
              class="drawing-mode"
              type="button"
              :disabled="readonly"
              :aria-label="mode.label"
              :title="mode.label"
              :aria-pressed="!cursorMode && group === mode.group && tool === mode.shape"
              @click="
                cursorMode = false;
                group = mode.group;
                tool = mode.shape;
              "
            >
              <span class="mode-icon" aria-hidden="true">
                <component :is="mode.shape === 'rectangle' ? Square : Circle" :size="20" />
                <component :is="mode.group === 'include' ? Plus : Minus" class="operation-icon" :size="12" />
              </span>
            </button>
          </template>
        </div>
      </div>
      <p v-if="loading" class="status">Loading full world map…</p>
      <p v-if="error" class="error" role="alert">{{ error }} <button type="button" @click="load">Retry</button></p>
      <div class="workspace">
        <div
          ref="viewport"
          class="map-scroll"
          :class="{ panning }"
          @wheel.prevent.stop="wheel"
          @pointerdown="beginPan"
          @pointermove="movePan"
          @pointerup="endPan"
          @pointercancel="endPan"
          @lostpointercapture="endPan"
          @auxclick.prevent
        >
          <div
            v-if="map"
            class="map-content"
            :class="{ 'cursor-mode': cursorMode, 'moving-shape': movingShape }"
            :style="{ width: `${map.width * zoom}px`, height: `${map.height * zoom}px` }"
          >
            <canvas
              ref="canvas"
              :style="map ? { width: `${map.width * zoom}px`, height: `${map.height * zoom}px` } : {}"
              @pointerdown="down"
              @pointermove="move"
              @pointerup="up"
              @pointercancel="cancelDraw"
              @lostpointercapture="cancelDraw"
            />
            <button
              v-for="handle in handles"
              :key="handle.key"
              class="resize-handle"
              type="button"
              :aria-label="`Resize ${shape?.type} ${handle.key} handle`"
              :style="{
                left: `${(handle.x - map.x + 0.5) * zoom}px`,
                top: `${(handle.y - map.y + 0.5) * zoom}px`,
                cursor: shape?.type === 'circle' ? 'crosshair' : `${handle.key}-resize`,
              }"
              @pointerdown.stop.prevent="beginResize($event, handle.key)"
              @pointermove.stop="moveResize"
              @pointerup.stop="endResize"
              @pointercancel.stop="cancelResize"
              @lostpointercapture="cancelResize"
              @click.stop
            />
          </div>
        </div>
        <aside>
          <template v-for="key in ['include', 'exclude'] as const" :key="key"
            ><h3>{{ key === 'include' ? 'Includes' : 'Excludes' }}</h3>
            <button
              v-for="(s, index) in draft[key]"
              :key="index"
              class="shape-item"
              :aria-pressed="selected?.group === key && selected.index === index"
              type="button"
              @click="selectShape(key, index)"
            >
              {{ index + 1 }}. {{ s.type }} ({{ s.x }}, {{ s.y }}, {{ s.z }})
            </button></template
          >
          <div v-if="shape" class="shape-fields">
            <label v-for="[key, value] in shapeFields" :key="key"
              >{{ key }}
              <input
                :value="value"
                type="number"
                step="1"
                :readonly="readonly"
                :min="key === 'radius' ? 0 : ['width', 'height'].includes(key) ? 1 : undefined"
                @change="edit(key, $event)" /></label
            ><button class="danger" type="button" :disabled="readonly" @click="remove">Delete shape</button>
          </div>
        </aside>
      </div>
      <footer>
      <span></span>
        <button class="secondary" type="button" @click="dialog?.close()">Cancel</button
        ><button type="button" :disabled="readonly" @click="apply">Apply area</button>
      </footer>
    </dialog>
  </div>
</template>
<style scoped>
.area-input {
  min-width: 0;
}
.area-picker {
  width: min(1200px, calc(100vw - 48px));
  max-height: calc(100dvh - 48px);
  box-sizing: border-box;
  padding: 0;
  overflow: auto;
  color: #e4e4e7;
  background: #18181b;
  border: 1px solid #3f3f46;
  border-radius: 8px;
  box-shadow: 0 18px 60px #000b;
  font:
    13px/1.4 Inter,
    system-ui,
    sans-serif;
  pointer-events: auto;
  color-scheme: dark;
}
.area-picker::backdrop {
  background: rgba(0, 0, 0, 0.65);
}
header,
footer,
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
header,
footer {
  padding: 12px 18px;
}
header {
  border-bottom: 1px solid rgba(212, 212, 216, 0.14);
}
header h2 {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 650;
}
footer {
  border-top: 1px solid rgba(212, 212, 216, 0.14);
}
footer span {
  flex: 1;
  min-width: 180px;
  color: #a1a1aa;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.hint,
.status,
.error {
  margin: 12px 18px;
}
.hint,
.status {
  color: #a1a1aa;
}
.error,
.area-input > [role='alert'] {
  color: #f87171;
}
.toolbar {
  box-sizing: border-box;
  width: 100%;
  flex-wrap: nowrap;
  overflow-x: auto;
  padding: 14px 18px;
}
.toolbar > * {
  flex-shrink: 0;
}
.floor-control,
.toolbar label {
  display: grid;
  gap: 6px;
  color: #d4d4d8;
}
.floor-buttons {
  display: flex;
  gap: 4px;
  align-items: center;
}
.floor-buttons button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 36px;
  padding: 0;
}
.floor-buttons input {
  width: 56px;
  height: 36px;
  text-align: center;
}
.drawing-modes {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  align-items: center;
  align-self: end;
}
.mode-separator {
  flex: 0 0 1px;
  height: 24px;
  margin: 0 4px;
  background: #3f3f46;
}
.drawing-mode {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-color: #3f3f46;
  color: #d4d4d8;
  background: #27272a;
}
.mode-icon {
  position: relative;
  display: flex;
}
.operation-icon {
  position: absolute;
  right: -4px;
  bottom: -4px;
  padding: 1px;
  border-radius: 3px;
  background: #27272a;
}
.drawing-mode[aria-pressed='true'] .operation-icon {
  background: #51303a;
}
.drawing-mode[aria-pressed='true'] {
  border-color: #fb7185;
  color: #ffe4e6;
  background: rgba(251, 113, 133, 0.24);
  box-shadow: inset 0 0 0 1px #fb7185;
}
.toolbar > button {
  align-self: end;
}
input,
select {
  box-sizing: border-box;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  outline: none;
  color: #fafafa;
  background: #18181b;
  font: inherit;
}
input {
  width: 80px;
}
input:focus,
select:focus {
  border-color: #fb7185;
  box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.14);
}
button {
  padding: 5px 13px;
  border: 1px solid rgba(251, 113, 133, 0.42);
  border-radius: 6px;
  color: #ffe4e6;
  background: rgba(251, 113, 133, 0.14);
  font: inherit;
  cursor: pointer;
}
button:hover:not(:disabled),
button:focus-visible {
  outline: none;
  border-color: rgba(251, 113, 133, 0.42);
  background: rgba(251, 113, 133, 0.24);
}
button:focus-visible {
  box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.14);
}
button.secondary {
  border-color: rgba(212, 212, 216, 0.22);
  color: #d4d4d8;
  background: #27272a;
}
button.secondary:hover,
button.secondary:focus-visible {
  border-color: rgba(251, 113, 133, 0.42);
  color: #fda4af;
  background: rgba(251, 113, 133, 0.14);
}
button.danger {
  border-color: rgba(248, 113, 113, 0.42);
  color: #fee2e2;
  background: rgba(248, 113, 113, 0.14);
}
button:disabled,
select:disabled {
  opacity: 0.45;
  cursor: default;
}
.picker-trigger {
  width: 100%;
  padding: 8px 12px;
  text-align: left;
}
.workspace {
  display: flex;
  height: min(60vh, 650px);
  min-height: 180px;
  border-top: 1px solid rgba(212, 212, 216, 0.14);
}
.map-scroll {
  overscroll-behavior: contain;
  touch-action: none;
  flex: 1;
  overflow: auto;
  background: #09090b;
  min-width: 0;
}
.map-content {
  position: relative;
}
.cursor-mode canvas {
  cursor: default;
}
.moving-shape canvas {
  cursor: grabbing;
}
.resize-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  padding: 0;
  transform: translate(-50%, -50%);
  border: 1px solid #18181b;
  border-radius: 2px;
  background: #fafafa;
  touch-action: none;
}
.resize-handle:hover,
.resize-handle:focus-visible {
  background: #fb7185;
}
canvas {
  display: block;
  image-rendering: pixelated;
  touch-action: none;
  cursor: crosshair;
}
.map-scroll.panning,
.map-scroll.panning canvas {
  cursor: grabbing;
  user-select: none;
}
aside {
  flex: 0 0 240px;
  box-sizing: border-box;
  padding: 12px;
  overflow: auto;
  border-left: 1px solid #3f3f46;
  background: #09090b;
}
aside h3 {
  margin: 12px 0 8px;
  color: #a1a1aa;
  font-size: 11px;
  font-weight: 650;
}
aside h3:first-child {
  margin-top: 0;
}
.shape-item {
  display: block;
  width: 100%;
  margin-bottom: 4px;
  padding: 8px 9px;
  text-align: left;
  color: #d4d4d8;
  background: transparent;
  border-color: transparent;
  overflow-wrap: anywhere;
}
.shape-item[aria-pressed='true'] {
  color: #fda4af;
  border-color: rgba(251, 113, 133, 0.42);
  background: rgba(251, 113, 133, 0.14);
}
.shape-fields {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #3f3f46;
}
.shape-fields label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  color: #d4d4d8;
}
.shape-fields > button {
  width: 100%;
  margin-top: 4px;
}
@media (max-width: 700px) {
  .area-picker {
    width: calc(100vw - 24px);
    max-height: calc(100dvh - 24px);
  }
  .workspace {
    flex-direction: column;
    height: 60vh;
  }
  .map-scroll {
    min-height: 180px;
  }
  aside {
    flex: 0 1 180px;
    width: 100%;
    border-left: 0;
    border-top: 1px solid #3f3f46;
  }
}
</style>
