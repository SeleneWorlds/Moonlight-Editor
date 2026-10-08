<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { useSelene, type VisualDefinition, type VisualFrameDefinition } from './selene';

interface Layer {
  texture: string;
  flipX: boolean;
  flipY: boolean;
}

const props = defineProps<{ identifier: string }>();
const selene = useSelene();
const layers = ref<Layer[]>([]);
let generation = 0;

function firstFrame(definition: VisualDefinition): VisualFrameDefinition | undefined {
  const frame = definition.frames?.[0];
  if (frame) {
    return typeof frame === 'string' ? { ...definition, texture: frame } : { ...definition, ...frame };
  }
  if (definition.textures?.[0]) {
    return { ...definition, texture: definition.textures[0] };
  }
  if (definition.texture) {
    return definition;
  }
  const animations = definition.animations ?? {};
  const animation = animations['stationary/west'] ?? animations['idle/west'] ?? Object.values(animations)[0];
  const animationFrame = animation?.frames?.[0];
  if (animationFrame) {
    return typeof animationFrame === 'string'
      ? { ...definition, ...animation, texture: animationFrame }
      : { ...definition, ...animation, ...animationFrame };
  }
  return animation?.textures?.[0] ? { ...definition, ...animation, texture: animation.textures[0] } : undefined;
}

async function load(): Promise<void> {
  const current = ++generation;
  layers.value = [];
  try {
    const definition = await selene.visuals.getDefinition(props.identifier);
    const resolved = await Promise.all(
      (definition.layers?.length ? definition.layers : [definition]).map(async (part): Promise<Layer | undefined> => {
        const frame = firstFrame(part);
        return frame?.texture
          ? {
              texture: await selene.resolveAsset(frame.texture),
              flipX: frame.flipX ?? false,
              flipY: frame.flipY ?? false,
            }
          : undefined;
      }),
    );
    if (current === generation) {
      layers.value = resolved.filter((layer): layer is Layer => layer !== undefined);
    }
  } catch (error) {
    console.warn('[Moonlight Editor] Could not load gizmo visual', props.identifier, error);
  }
}

watch(
  () => props.identifier,
  () => void load(),
  { immediate: true },
);
onUnmounted(() => generation++);
</script>

<template>
  <span class="gizmo-visual" aria-hidden="true">
    <img
      v-for="(layer, index) in layers"
      :key="`${index}:${layer.texture}`"
      :src="layer.texture"
      alt=""
      :style="{ transform: `translate(-50%, -50%) scale(${layer.flipX ? -1 : 1}, ${layer.flipY ? -1 : 1})` }"
    />
  </span>
</template>

<style scoped>
.gizmo-visual {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.gizmo-visual img {
  position: absolute;
  top: 50%;
  left: 50%;
  display: block;
  max-width: 20px;
  max-height: 20px;
  object-fit: contain;
  user-select: none;
}
</style>
