<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  minimum?: number;
  maximum?: number;
  lower?: number;
  upper?: number;
  required: boolean;
  label: string;
}>();
const emit = defineEmits<{ update: [value: { min: number; max: number }] }>();
const bounded = computed(
  () => Number.isFinite(props.minimum) && Number.isFinite(props.maximum) && props.minimum! < props.maximum!,
);
function clamp(value: number): number {
  return Math.max(props.minimum ?? -Infinity, Math.min(props.maximum ?? Infinity, value));
}
const lower = computed(() => clamp(props.lower ?? props.minimum ?? props.upper ?? 0));
const upper = computed(() => clamp(props.upper ?? props.maximum ?? props.lower ?? 0));
const trackStyle = computed(() => {
  const width = props.maximum! - props.minimum!;
  return {
    '--lower': `${((lower.value - props.minimum!) / width) * 100}%`,
    '--upper': `${((upper.value - props.minimum!) / width) * 100}%`,
  };
});
function update(bound: 'min' | 'max', event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.value === '' || !Number.isFinite(input.valueAsNumber)) {
    return;
  }
  const value = clamp(Math.round(input.valueAsNumber));
  const currentLower = props.lower === undefined ? clamp(props.minimum ?? value) : lower.value;
  const currentUpper = props.upper === undefined ? clamp(props.maximum ?? value) : upper.value;
  emit(
    'update',
    bound === 'min'
      ? { min: Math.min(value, currentUpper), max: currentUpper }
      : { min: currentLower, max: Math.max(value, currentLower) },
  );
}
</script>

<template>
  <div class="range-control">
    <div v-if="bounded" class="slider" :style="trackStyle">
      <div class="track" />
      <input
        v-for="bound in ['min', 'max'] as const"
        :key="bound"
        type="range"
        :min="minimum"
        :max="maximum"
        step="1"
        :value="bound === 'min' ? lower : upper"
        :aria-label="`${label} ${bound === 'min' ? 'minimum' : 'maximum'}`"
        :style="{ zIndex: bound === 'min' && lower === maximum ? 3 : bound === 'max' ? 2 : 1 }"
        @input="update(bound, $event)"
      />
    </div>
    <div class="numbers">
      <label v-for="bound in ['min', 'max'] as const" :key="bound">
        <span>{{ bound === 'min' ? 'Min' : 'Max' }}</span>
        <input
          type="number"
          step="1"
          :value="bound === 'min' ? props.lower : props.upper"
          :min="bound === 'max' ? (props.lower ?? minimum) : minimum"
          :max="bound === 'min' ? (props.upper ?? maximum) : maximum"
          :required="required"
          :aria-label="`${label} ${bound === 'min' ? 'minimum' : 'maximum'}`"
          @change="update(bound, $event)"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.range-control {
  min-width: 0;
}
.slider {
  position: relative;
  height: 28px;
  margin: 0 9px 8px;
}
.track {
  position: absolute;
  top: 11px;
  left: 0;
  right: 0;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(
    to right,
    #3f3f46 var(--lower),
    #fb7185 var(--lower),
    #fb7185 var(--upper),
    #3f3f46 var(--upper)
  );
}
.slider input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 28px;
  margin: 0;
  padding: 0;
  appearance: none;
  background: transparent;
  pointer-events: none;
}
.slider input::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #18181b;
  background: #fb7185;
  pointer-events: auto;
  cursor: grab;
}
.slider input::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #18181b;
  background: #fb7185;
  pointer-events: auto;
  cursor: grab;
}
.slider input:focus-visible {
  outline: 2px solid #fb7185;
  outline-offset: 3px;
  border-radius: 6px;
}
.numbers {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.numbers label {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 6px;
  color: #71717a;
}
.numbers input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  color: #fafafa;
  background: #18181b;
  font: inherit;
}
.numbers input:focus {
  outline: none;
  border-color: #fb7185;
  box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.14);
}
</style>
