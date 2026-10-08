<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useSelene, type Coordinate } from './selene';
const selene = useSelene();
const menu = ref<{
  coordinate: Coordinate;
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  requestId: number;
} | null>(null);
const menuElement = ref<HTMLElement | null>(null);
const actions = ref<Array<{ id: string; label: string }>>([]);
let requestId = 0;
const releases: Array<() => void> = [];
function close(): void {
  menu.value = null;
}
function dismissOutside(event: PointerEvent): void {
  const element = menuElement.value;
  const root = element?.getRootNode();
  // Window listeners see the host as the target of clicks in a closed shadow root.
  // Hit-test within that root to preserve menu clicks until the button executes.
  if (
    element &&
    (root instanceof ShadowRoot || root instanceof Document) &&
    element.contains(root.elementFromPoint(event.clientX, event.clientY))
  ) {
    return;
  }
  close();
}
function escape(event: KeyboardEvent): void {
  if (event.key === 'Escape' && menu.value) {
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }
}
function execute(id: string): void {
  if (!menu.value) {
    return;
  }
  selene.network.sendToServer('moonlight-editor:execute-context-action', { id, ...menu.value.coordinate });
  close();
}
onMounted(() => {
  window.addEventListener('pointerdown', dismissOutside, true);
  window.addEventListener('keydown', escape, true);
  window.addEventListener('resize', close);
  releases.push(
    selene.input.onPointerDown((event) => {
      close();
      if (event.button !== 2) {
        return;
      }
      actions.value = [];
      menu.value = {
        coordinate: { ...event.coordinate },
        x: 0,
        y: 0,
        clientX: event.clientX,
        clientY: event.clientY,
        requestId: ++requestId,
      };
      selene.network.sendToServer('moonlight-editor:query-context-menu', { ...event.coordinate, requestId });
    }),
    selene.network.onPayload('moonlight-editor:context-menu', (payload) => {
      if (!menu.value || payload.requestId !== menu.value.requestId || !Array.isArray(payload.actions)) {
        return;
      }
      actions.value = payload.actions.filter(
        (action): action is { id: string; label: string } =>
          typeof action?.id === 'string' && typeof action?.label === 'string',
      );
      if (!actions.value.length) {
        close();
        return;
      }
      const current = menu.value;
      void nextTick(() => {
        const element = menuElement.value;
        if (menu.value !== current || !element) {
          return;
        }
        // Fixed elements inherit the bundle UI layer's offset and render scale.
        const bounds = element.getBoundingClientRect();
        const scaleX = bounds.width / element.offsetWidth;
        const scaleY = bounds.height / element.offsetHeight;
        const left = Math.max(0, Math.min(current.clientX, window.innerWidth - bounds.width));
        const top = Math.max(0, Math.min(current.clientY, window.innerHeight - bounds.height));
        current.x = (left - bounds.left) / scaleX;
        current.y = (top - bounds.top) / scaleY;
      });
    }),
    selene.world.onCameraCoordinateChanged(close),
    selene.network.onConnected(close),
  );
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', dismissOutside, true);
  window.removeEventListener('keydown', escape, true);
  window.removeEventListener('resize', close);
  releases.forEach((release) => release());
});
</script>
<template>
  <div
    v-if="menu && actions.length"
    ref="menuElement"
    class="context-menu"
    role="menu"
    aria-label="Coordinate actions"
    :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
    @pointerdown.stop
    @pointerup.stop
    @contextmenu.prevent
  >
    <button v-for="action in actions" :key="action.id" type="button" role="menuitem" @click="execute(action.id)">
      {{ action.label }}
    </button>
  </div>
</template>
<style scoped>
.context-menu {
  position: fixed;
  z-index: 100;
  width: 210px;
  max-height: 230px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid #46516a;
  border-radius: 6px;
  background: #18202f;
  box-shadow: 0 6px 24px #0008;
  pointer-events: auto;
}
button {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: #edf2ff;
  text-align: left;
  cursor: pointer;
}
button:hover,
button:focus-visible {
  background: #33425c;
}
</style>
