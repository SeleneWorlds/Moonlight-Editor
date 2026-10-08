<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Copy, FilePlus, Pipette } from '@lucide/vue';
import type { DistancePick, SchemaDefinition } from './schema';
import SchemaForm from './SchemaForm.vue';

interface ProjectFile {
  path: string;
  name?: string;
}

const props = defineProps<{
  bundles: string[];
  registries: string[];
  projectFiles: ProjectFile[];
  projectLoading: boolean;
  editorLoading: boolean;
  selectedPath: string | null;
  isDirty: boolean;
  permissions: { apply: boolean; persist: boolean; discard: boolean; persistAll: boolean; discardAll: boolean };
  pendingChanges: number;
  pendingPaths: string[];
  localPaths: string[];
  status: string;
  statusIsError: boolean;
  schema: Record<string, SchemaDefinition> | null;
  registryOptions: Record<string, Array<{ value: string; label: string; visual?: string }>>;
}>();

const selectedBundle = defineModel<string>('selectedBundle', { required: true });
const selectedRegistry = defineModel<string>('selectedRegistry', { required: true });
const contents = defineModel<string>('contents', { required: true });

const enabledField = computed(
  () =>
    Object.entries(props.schema ?? {}).find(
      ([, definition]) => (typeof definition === 'string' ? definition : definition.type) === 'enabled',
    )?.[0],
);
const parsedContents = computed<Record<string, unknown> | null>(() => {
  try {
    const value: unknown = JSON.parse(contents.value);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
});
const formSchema = computed(() =>
  props.schema
    ? Object.fromEntries(Object.entries(props.schema).filter(([name]) => name !== enabledField.value))
    : null,
);

function toggleEnabled(): void {
  const field = enabledField.value;
  if (props.permissions.apply && field && parsedContents.value) {
    contents.value = `${JSON.stringify({ ...parsedContents.value, [field]: parsedContents.value[field] !== true }, null, 2)}\n`;
  }
}

const emit = defineEmits<{
  selectBundle: [];
  requestProject: [];
  openFile: [path: string];
  save: [];
  discardLocal: [];
  persist: [path?: string];
  discard: [path?: string];
  close: [];
  searchRegistry: [registry: string, query: string, lookup?: boolean];
  pickCoordinate: [field: string];
  pickDistance: [pick: DistancePick];
  pickResource: [];
  createFile: [name: string];
  duplicateFile: [name: string];
}>();

const createDialog = ref<HTMLDialogElement | null>(null);
const entryName = ref('');
const createSubmitted = ref(false);
const createAttempted = ref(false);
const duplicating = ref(false);
const entryNameError = computed(() => {
  const name = entryName.value.trim();
  if (!name) {
    return 'Enter a name.';
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return 'Use letters, numbers, underscores, or hyphens.';
  }
  if (props.projectFiles.some(({ path }) => pathWithinRegistry(path) === `${name}.json`)) {
    return 'An entry with this name already exists.';
  }
  return '';
});

function openCreateDialog(duplicate = false): void {
  duplicating.value = duplicate;
  entryName.value = duplicate
    ? `${
        props.selectedPath
          ?.split('/')
          .pop()
          ?.replace(/\.json$/, '') ?? 'entry'
      }_copy`
    : '';
  createAttempted.value = false;
  createSubmitted.value = false;
  createDialog.value?.showModal();
}

function closeCreateDialog(): void {
  createSubmitted.value = false;
  createDialog.value?.close();
}

function submitCreate(): void {
  if (entryNameError.value || createSubmitted.value) {
    return;
  }
  createSubmitted.value = true;
  createAttempted.value = true;
  fileSearch.value = '';
  if (duplicating.value) {
    emit('duplicateFile', entryName.value.trim());
  } else {
    emit('createFile', entryName.value.trim());
  }
}

watch(
  () => props.editorLoading,
  (loading) => {
    if (createSubmitted.value && !loading) {
      createSubmitted.value = false;
      if (!props.statusIsError) {
        closeCreateDialog();
      }
    }
  },
);

const confirmation = defineModel<'persist' | 'discard' | null>('confirmation', { required: true });
const confirmationPath = ref<string | null>(null);
const confirmationPaths = computed(() =>
  confirmationPath.value === null
    ? props.pendingPaths
    : props.pendingPaths.filter((path) => path === confirmationPath.value),
);
const resourceHasChanges = computed(
  () => props.selectedPath !== null && props.pendingPaths.includes(props.selectedPath),
);

const confirmationAllowed = computed(() => {
  if (confirmation.value === 'persist') {
    return confirmationPath.value === null ? props.permissions.persistAll : props.permissions.persist;
  }
  return confirmationPath.value === null ? props.permissions.discardAll : props.permissions.discard;
});

function requestConfirmation(action: 'persist' | 'discard', path: string | null = null): void {
  confirmationPath.value = path;
  confirmation.value = action;
}

const confirmationDialog = ref<HTMLDialogElement | null>(null);
watch(confirmation, (action) => {
  if (action) {
    confirmationDialog.value?.showModal();
  } else {
    confirmationDialog.value?.close();
  }
});

function confirmChanges(): void {
  if (!confirmationAllowed.value) {
    return;
  }
  const action = confirmation.value;
  const path = confirmationPath.value ?? undefined;
  const hasChanges = confirmationPaths.value.length > 0;
  confirmation.value = null;
  if (!hasChanges) {
    return;
  }
  if (action === 'persist') {
    emit('persist', path);
  } else if (action === 'discard') {
    emit('discard', path);
  }
}

const activeTab = ref<'form' | 'json'>('form');
watch(
  () => props.selectedPath,
  () => {
    activeTab.value = props.schema ? 'form' : 'json';
  },
);
watch(
  () => props.schema,
  (schema) => {
    activeTab.value = schema ? 'form' : 'json';
  },
);

const selectedFile = computed(() => props.projectFiles.find(({ path }) => path === props.selectedPath));
const fileSearch = ref('');
const filteredFiles = computed(() => {
  const query = fileSearch.value.trim().toLowerCase();
  const changedPaths = new Set([...props.localPaths, ...props.pendingPaths]);
  return props.projectFiles
    .filter(({ path, name }) => !query || path.toLowerCase().includes(query) || name?.toLowerCase().includes(query))
    .sort((a, b) => Number(changedPaths.has(b.path)) - Number(changedPaths.has(a.path)));
});
watch([selectedBundle, selectedRegistry], () => {
  fileSearch.value = '';
  closeCreateDialog();
});

function pathWithinRegistry(path: string): string {
  const match = path.match(/\/(?:common|server)\/data\/[^/]+\/[^/]+\/(.+)$/);
  return match?.[1] ?? path;
}

function searchRegistry(registry: string, query: string, lookup?: boolean): void {
  emit('searchRegistry', registry, query, lookup);
}
</script>

<template>
  <div class="file-modal">
    <div class="peek-zone" aria-hidden="true" />
    <section class="project">
      <aside class="browser">
        <div class="browser-content">
          <label class="bundle-picker">
            <span>Bundle</span>
            <select v-model="selectedBundle" :disabled="bundles.length === 0" @change="emit('selectBundle')">
              <option v-for="bundle in bundles" :key="bundle" :value="bundle">{{ bundle }}</option>
            </select>
          </label>
          <label class="bundle-picker">
            <span>Registry</span>
            <select v-model="selectedRegistry" :disabled="registries.length === 0" @change="emit('requestProject')">
              <option v-for="registry in registries" :key="registry" :value="registry">{{ registry }}</option>
            </select>
          </label>
          <div class="file-search">
            <label class="bundle-picker">
              <span>Search</span>
              <input
                v-model="fileSearch"
                type="search"
                placeholder="Search paths or names…"
                :disabled="!selectedBundle || !selectedRegistry"
                spellcheck="false"
              />
            </label>
            <button
              class="close"
              type="button"
              :disabled="!selectedBundle || !selectedRegistry"
              title="Pick a resource in this registry from the world"
              aria-label="Pick a resource in this registry from the world"
              @click="emit('pickResource')"
            >
              <Pipette :size="16" aria-hidden="true" />
            </button>
            <button
              class="close"
              type="button"
              :disabled="!selectedBundle || !selectedRegistry || projectLoading || editorLoading"
              title="Create a new registry entry"
              aria-label="Create a new registry entry"
              @click="openCreateDialog()"
            >
              <FilePlus :size="16" aria-hidden="true" />
            </button>
          </div>
          <div v-if="projectLoading" class="loading" role="status" aria-label="Loading paths">
            <span class="spinner" aria-hidden="true" />
          </div>
          <p v-else-if="filteredFiles.length === 0" class="files-empty" role="status">
            {{ fileSearch.trim() ? 'No matching files.' : 'No files in this registry.' }}
          </p>
          <ul v-else class="files">
            <li v-for="file in filteredFiles" :key="file.path">
              <button
                :class="{ active: file.path === selectedPath }"
                :title="file.path"
                @click="emit('openFile', file.path)"
              >
                <span class="file-heading">
                  <span class="file-name">{{ file.name ?? pathWithinRegistry(file.path) }}</span>
                  <span
                    v-if="localPaths.includes(file.path)"
                    class="change-dot local"
                    title="Unapplied local changes"
                    role="img"
                    aria-label="Unapplied local changes"
                  />
                  <span
                    v-if="pendingPaths.includes(file.path)"
                    class="change-dot pending"
                    title="Unpersisted changes"
                    role="img"
                    aria-label="Unpersisted changes"
                  />
                </span>
                <small>({{ pathWithinRegistry(file.path) }})</small>
              </button>
            </li>
          </ul>
        </div>
        <footer class="browser-footer" aria-label="Batch resource actions">
          <button
            class="persist"
            :disabled="pendingChanges === 0 || !permissions.persistAll"
            @click="requestConfirmation('persist')"
          >
            Persist {{ pendingChanges }} changes
          </button>
          <button
            class="discard"
            :disabled="pendingChanges === 0 || !permissions.discardAll"
            @click="requestConfirmation('discard')"
          >
            Rollback {{ pendingChanges }} changes
          </button>
        </footer>
      </aside>
      <main class="editor">
        <header class="toolbar">
          <button
            v-if="selectedPath && enabledField"
            class="enabled-switch"
            type="button"
            role="switch"
            :aria-checked="parsedContents?.[enabledField] === true"
            aria-label="Enabled"
            :title="parsedContents?.[enabledField] === true ? 'Disable resource' : 'Enable resource'"
            :disabled="editorLoading || !parsedContents || !permissions.apply"
            @click="toggleEnabled"
          >
            <span />
          </button>
          <span class="path">
            <template v-if="selectedPath">
              <span>{{ selectedFile?.name ?? pathWithinRegistry(selectedPath) }}</span>
              <small>({{ pathWithinRegistry(selectedPath) }})</small>
            </template>
            <template v-else>Select a file</template>
          </span>
          <button class="close" @click="emit('close')">Close</button>
        </header>
        <div v-if="editorLoading" class="loading" role="status" aria-label="Loading editor">
          <span class="spinner" aria-hidden="true" />
        </div>
        <div v-else-if="selectedPath" class="document">
          <div class="document-toolbar">
            <nav class="tabs" aria-label="Editor view">
              <button v-if="schema" :class="{ active: activeTab === 'form' }" type="button" @click="activeTab = 'form'">
                Form
              </button>
              <button :class="{ active: activeTab === 'json' }" type="button" @click="activeTab = 'json'">
                Raw JSON
              </button>
            </nav>
            <div class="resource-actions" aria-label="Resource actions">
              <button
                class="close"
                type="button"
                :disabled="editorLoading || projectLoading"
                title="Duplicate"
                aria-label="Duplicate"
                @click="openCreateDialog(true)"
              >
                <Copy :size="16" aria-hidden="true" />
              </button>
              <button class="save" :disabled="!isDirty || editorLoading || !permissions.apply" @click="emit('save')">
                Apply
              </button>
              <button class="discard" :disabled="!isDirty || editorLoading" @click="emit('discardLocal')">
                Discard
              </button>
              <button
                class="persist"
                :disabled="!resourceHasChanges || editorLoading || !permissions.persist"
                @click="requestConfirmation('persist', selectedPath)"
              >
                Persist
              </button>
              <button
                class="discard"
                :disabled="!resourceHasChanges || editorLoading || !permissions.discard"
                @click="requestConfirmation('discard', selectedPath)"
              >
                Rollback
              </button>
            </div>
          </div>
          <SchemaForm
            v-if="schema && activeTab === 'form'"
            class="document-form"
            :readonly="!permissions.apply"
            :schema="formSchema!"
            :contents="contents"
            :registry-options="registryOptions"
            @update-contents="permissions.apply && (contents = $event)"
            @search-registry="searchRegistry"
            @pick-coordinate="emit('pickCoordinate', $event)"
            @pick-distance="emit('pickDistance', $event)"
          />
          <textarea v-else v-model="contents" :readonly="!permissions.apply" spellcheck="false" />
        </div>
        <div v-else class="empty">Select a bundle data file.</div>
        <footer class="status" :class="{ error: statusIsError }">{{ status }}</footer>
      </main>
      <dialog
        ref="createDialog"
        class="confirmation"
        aria-labelledby="create-entry-title"
        @cancel.prevent="closeCreateDialog"
      >
        <form @submit.prevent="submitCreate">
          <h2 id="create-entry-title">{{ duplicating ? 'Duplicate entry' : 'New entry' }}</h2>
          <label class="bundle-picker">
            <span>Name</span>
            <input
              v-model="entryName"
              autofocus
              required
              autocomplete="off"
              spellcheck="false"
              :disabled="createSubmitted"
            />
          </label>
          <p v-if="entryName.trim() && entryNameError" class="name-error" role="alert">{{ entryNameError }}</p>
          <p v-if="createAttempted && statusIsError && !createSubmitted" class="name-error" role="alert">
            {{ status }}
          </p>
          <div class="confirmation-actions">
            <button class="close" type="button" @click="closeCreateDialog">Cancel</button>
            <button class="save" type="submit" :disabled="!!entryNameError || createSubmitted">
              {{ createSubmitted ? 'Creating…' : 'Create' }}
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref="confirmationDialog"
        class="confirmation"
        aria-labelledby="confirmation-title"
        @cancel.prevent="confirmation = null"
      >
        <h2 id="confirmation-title">{{ confirmation === 'persist' ? 'Persist' : 'Rollback' }} changes?</h2>
        <p v-if="confirmation === 'persist'">Write pending changes to the following resource files:</p>
        <p v-else>Restore the file-backed values for the following resources:</p>
        <ul class="resource-list">
          <li v-for="path in confirmationPaths" :key="path">{{ path }}</li>
        </ul>
        <p v-if="confirmationPaths.length === 0">No pending resources available.</p>
        <div class="confirmation-actions">
          <button class="close" type="button" autofocus @click="confirmation = null">Cancel</button>
          <button
            :class="confirmation === 'persist' ? 'persist' : 'discard'"
            type="button"
            :disabled="confirmationPaths.length === 0 || !confirmationAllowed"
            @click="confirmChanges"
          >
            {{ confirmation === 'persist' ? 'Persist' : 'Rollback' }} {{ confirmationPaths.length }}
            {{ confirmationPaths.length === 1 ? 'resource' : 'resources' }}
          </button>
        </div>
      </dialog>
    </section>
  </div>
</template>

<style scoped>
.file-modal {
  display: contents;
}
.confirmation {
  width: min(640px, 80vw);
  padding: 24px;
  border: 1px solid #3f3f46;
  border-radius: 8px;
  color: #e4e4e7;
  background: #18181b;
  box-shadow: 0 18px 60px #000b;
}
.name-error {
  color: #f87171;
}
.confirmation::backdrop {
  background: rgba(0, 0, 0, 0.65);
}
.confirmation h2 {
  margin-top: 0;
}
.resource-list {
  max-height: 45vh;
  overflow: auto;
  padding-left: 24px;
  overflow-wrap: anywhere;
}
.resource-list li {
  padding: 4px 0;
}
.confirmation-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.peek-zone {
  position: fixed;
  z-index: 1001;
  inset: 0 25vw auto;
  height: 5vh;
  pointer-events: auto;
}
.peek-zone:hover + .project:not(:has(dialog[open])) {
  opacity: 0.08;
  backdrop-filter: none;
}
.project {
  transition: opacity 160ms ease;
  position: fixed;
  z-index: 1000;
  inset: 5vh 4vw;
  display: grid;
  grid-template-columns: minmax(230px, 28%) 1fr;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(212, 212, 216, 0.2);
  border-top: 4px solid #fb7185;
  border-radius: 8px;
  background: rgba(24, 24, 27, 0.9);
  backdrop-filter: blur(16px);
  box-shadow: 0 18px 60px #000b;
  pointer-events: auto;
}
.browser {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(212, 212, 216, 0.14);
  background: rgba(9, 9, 11, 0.35);
  user-select: none;
}
.browser-content {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 12px;
}
.browser-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgba(212, 212, 216, 0.14);
  background: #18181b;
}
.browser-footer button {
  flex: 1;
}
.bundle-picker {
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
  color: #a1a1aa;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.bundle-picker select,
.bundle-picker input {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid rgba(212, 212, 216, 0.22);
  border-radius: 6px;
  outline: none;
  color: #fafafa;
  background: #09090b;
  font: inherit;
  text-transform: none;
}
.bundle-picker select:focus,
.bundle-picker input:focus {
  border-color: #fb7185;
  box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.14);
}
.file-search {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 10px;
}
.file-search .bundle-picker {
  min-width: 0;
  flex: 1;
  margin-bottom: 0;
}
.file-search button {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  padding: 0;
}
.file-search input,
.file-search button {
  box-sizing: border-box;
  height: 30px;
}
.files-empty {
  margin: 12px 0;
  color: #a1a1aa;
}
.files {
  margin: 0;
  padding: 0;
  list-style: none;
}
.files button {
  width: 100%;
  padding: 4px 7px;
  overflow: hidden;
  border: 0;
  border-radius: 3px;
  color: #d4d4d8;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.file-heading {
  display: flex;
  align-items: center;
  gap: 6px;
}
.file-name {
  min-width: 0;
  flex: 1;
}
.change-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
}
.change-dot.local {
  background: #60a5fa;
}
.change-dot.pending {
  background: #4ade80;
}
.file-name,
.files small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.files small {
  color: #71717a;
  font-size: 10px;
}
.files button.active small {
  color: #a1a1aa;
}
.files button:hover {
  background: rgba(251, 113, 133, 0.1);
}
.files button.active {
  color: #fafafa;
  background: rgba(251, 113, 133, 0.14);
}
.editor {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.document {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}
.document-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  border-bottom: 1px solid rgba(212, 212, 216, 0.14);
  background: #18181b;
}
.document-form {
  overflow: auto;
  padding-bottom: 300px;
}
.resource-actions {
  display: flex;
  gap: 8px;
  padding: 5px 10px;
}
.tabs {
  display: flex;
  gap: 2px;
  padding: 5px 10px 0;
  background: #18181b;
}
.tabs button {
  padding: 6px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  color: #a1a1aa;
  background: transparent;
  cursor: pointer;
}
.tabs button.active {
  border-bottom-color: #fb7185;
  color: #fafafa;
}
.toolbar {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-bottom: 1px solid rgba(212, 212, 216, 0.14);
}
.path {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #a1a1aa;
}
.enabled-switch {
  flex: 0 0 auto;
  width: 36px;
  height: 21px;
  padding: 2px;
  border: 1px solid #71717a;
  border-radius: 999px;
  background: #3f3f46;
  cursor: pointer;
}
.enabled-switch span {
  display: block;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fafafa;
  transition: transform 120ms ease;
}
.enabled-switch[aria-checked='true'] {
  border-color: #4ade80;
  background: #15803d;
}
.enabled-switch[aria-checked='true'] span {
  transform: translateX(15px);
}
.enabled-switch:focus-visible {
  outline: 2px solid #fafafa;
  outline-offset: 3px;
}
.enabled-switch:disabled {
  opacity: 0.5;
  cursor: default;
}
.path span,
.path small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.path span {
  color: #fafafa;
}
.path small {
  color: #71717a;
  font-size: 10px;
}
.save,
.persist,
.discard,
.close {
  padding: 5px 13px;
  border: 1px solid rgba(251, 113, 133, 0.42);
  border-radius: 6px;
  color: #ffe4e6;
  background: rgba(251, 113, 133, 0.14);
  cursor: pointer;
}
.close {
  border-color: rgba(212, 212, 216, 0.22);
  color: #d4d4d8;
  background: #27272a;
}
.persist {
  border-color: rgba(74, 222, 128, 0.42);
  color: #dcfce7;
  background: rgba(74, 222, 128, 0.14);
}
.discard {
  border-color: rgba(248, 113, 113, 0.42);
  color: #fee2e2;
  background: rgba(248, 113, 113, 0.14);
}
.save:hover:not(:disabled),
.save:focus-visible,
.persist:hover:not(:disabled),
.persist:focus-visible,
.discard:hover:not(:disabled),
.discard:focus-visible {
  outline: none;
  background: rgba(251, 113, 133, 0.24);
}
.close:hover,
.close:focus-visible {
  border-color: rgba(251, 113, 133, 0.42);
  outline: none;
  background: rgba(251, 113, 133, 0.14);
  color: #fda4af;
}
.save:disabled,
.persist:disabled,
.discard:disabled {
  opacity: 0.45;
  cursor: default;
}
textarea {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 14px;
  resize: none;
  border: 0;
  outline: 0;
  color: #fafafa;
  background: #09090b;
  font:
    13px/1.5 ui-monospace,
    SFMono-Regular,
    Consolas,
    monospace;
  tab-size: 2;
}
.loading {
  display: grid;
  min-height: 100px;
  place-items: center;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(212, 212, 216, 0.2);
  border-top-color: #fb7185;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .project {
    transition: none;
  }
  .spinner {
    animation-duration: 2s;
  }
}
.empty {
  display: grid;
  place-items: center;
  color: #a1a1aa;
}
.status {
  min-height: 20px;
  padding: 4px 12px;
  border-top: 1px solid rgba(212, 212, 216, 0.14);
  color: #a1a1aa;
}
.status.error {
  color: #f87171;
}
</style>
