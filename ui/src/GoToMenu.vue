<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { MapPin } from '@lucide/vue';
import GizmoVisual from './GizmoVisual.vue';
import { useSelene, type Coordinate } from './selene';
interface GoToTarget {
  name: string;
  type: string;
  coordinate: Coordinate;
  visual?: string;
}
const selene = useSelene();
const open = ref(false);
const loading = ref(false);
const search = ref('');
const targets = ref<GoToTarget[]>([]);
const input = ref<HTMLInputElement>();
const root = ref<HTMLElement>();
let releaseText: (() => void) | undefined;
let releaseKeys: (() => void) | undefined;
const matches = computed(() =>
  targets.value.filter((target) =>
    `${target.name} ${target.type} ${target.coordinate.x}, ${target.coordinate.y}, ${target.coordinate.z}`
      .toLowerCase()
      .includes(search.value.trim().toLowerCase()),
  ),
);
function close(): void {
  open.value = false;
  releaseText?.();
  releaseKeys?.();
  releaseText = undefined;
  releaseKeys = undefined;
}
function toggle(): void {
  if (open.value) {
    return close();
  }
  open.value = true;
  loading.value = true;
  search.value = '';
  releaseText = selene.input.captureText();
  releaseKeys = selene.input.captureKeys('Escape');
  selene.network.sendToServer('moonlight-editor:request-go-to-targets');
  void nextTick(() => input.value?.focus());
}
function goTo(target: GoToTarget): void {
  selene.network.sendToServer('moonlight-editor:go-to', { ...target.coordinate });
  close();
}
function outside(event: Event): void {
  if (open.value && root.value && !event.composedPath().includes(root.value)) {
    close();
  }
}
function keydown(event: KeyboardEvent): void {
  if (open.value && event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }
}
const releases = [
  selene.network.onPayload('moonlight-editor:go-to-targets-start', () => {
    targets.value = [];
  }),
  selene.network.onPayload('moonlight-editor:go-to-targets', (payload) => {
    if (Array.isArray(payload.targets)) {
      targets.value.push(...(payload.targets as GoToTarget[]));
    }
  }),
  selene.network.onPayload('moonlight-editor:go-to-targets-end', () => {
    loading.value = false;
  }),
];
let menuEventRoot: Node | undefined;
onMounted(() => {
  // Listen inside the closed shadow root, where the event path includes the menu.
  menuEventRoot = root.value?.getRootNode();
  menuEventRoot?.addEventListener('pointerdown', outside);
  // Events outside the shadow host are visible at document level.
  document.addEventListener('pointerdown', outsideHost);
});
function outsideHost(event: PointerEvent): void {
  if (menuEventRoot instanceof ShadowRoot && event.composedPath().includes(menuEventRoot.host)) {
    return;
  }
  outside(event);
}
window.addEventListener('keydown', keydown, true);
onBeforeUnmount(() => {
  close();
  releases.forEach((release) => release());
  menuEventRoot?.removeEventListener('pointerdown', outside);
  document.removeEventListener('pointerdown', outsideHost);
  window.removeEventListener('keydown', keydown, true);
});
</script>
<template>
  <div ref="root" class="go-to-menu">
    <button class="go-to-toggle" type="button" :aria-expanded="open" aria-controls="go-to-dropdown" @click="toggle">
      <MapPin :size="16" aria-hidden="true" /> Go To
    </button>
    <div v-if="open" id="go-to-dropdown" class="go-to-dropdown">
      <input
        ref="input"
        v-model="search"
        type="search"
        placeholder="Search destinations…"
        aria-label="Search destinations"
      />
      <div class="go-to-results">
        <p v-if="loading" role="status">Loading targets…</p>
        <p v-else-if="!matches.length" role="status">No destinations found.</p>
        <button v-for="(target, index) in matches" :key="index" type="button" class="go-to-target" @click="goTo(target)">
          <span v-if="target.visual" class="go-to-visual"><GizmoVisual :identifier="target.visual" /></span>
          <span class="go-to-text"
            ><strong>{{ target.name }}</strong
            ><small
              >{{ target.type }} · {{ target.coordinate.x }}, {{ target.coordinate.y }},
              {{ target.coordinate.z }}</small
            ></span
          >
        </button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.go-to-menu {
  position: relative;
  font: inherit;
}
.go-to-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 13px;
  border: 1px solid rgba(251, 113, 133, 0.42);
  border-radius: 6px;
  color: #ffe4e6;
  background: rgba(251, 113, 133, 0.14);
  font: inherit;
  cursor: pointer;
  user-select: none;
}
.go-to-toggle:hover,
.go-to-toggle:focus-visible {
  outline: none;
  background: rgba(251, 113, 133, 0.24);
}

.go-to-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  box-sizing: border-box;
  width: min(340px, calc(100vw - 24px));
  padding: 4px;
  border: 1px solid #3f3f46;
  border-radius: 7px;
  background: #18181b;
  color: #e4e4e7;
  box-shadow: 0 12px 30px #000a;
}
input {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid rgba(212, 212, 216, 0.22);
  border-radius: 6px;
  outline: none;
  color: #fafafa;
  background: #09090b;
  font: inherit;
}
input:focus {
  border-color: #fb7185;
  box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.14);
}
.go-to-results {
  max-height: min(270px, 60vh);
  overflow-y: auto;
  margin-top: 4px;
}
.go-to-target {
  font: inherit;
}
.go-to-visual {
  position: relative;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
}
.go-to-target {
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
.go-to-target:hover,
.go-to-target:focus-visible {
  background: rgba(251, 113, 133, 0.14);
}
.go-to-text {
  min-width: 0;
  display: grid;
}
.go-to-text strong,
.go-to-text small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.go-to-text small {
  color: #71717a;
  font-size: 10px;
}
.go-to-results p {
  margin: 8px;
  color: #71717a;
}
</style>
