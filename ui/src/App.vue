<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Focus, Database, ArrowDown, ArrowUp, Grid2X2 } from '@lucide/vue';
import type { DistancePick, SchemaDefinition } from './schema';
import { latestRequest } from './LatestRequest';
import { pickedDistance, projectedCircle } from './distance';
import { useSelene, requestEditorOperation, type ClientNetworkPayload, type Coordinate } from './selene';
import FileModal from './FileModal.vue';
import SchemaForm from './SchemaForm.vue';
import GizmoVisual from './GizmoVisual.vue';
import GoToMenu from './GoToMenu.vue';
import ContextMenu from './ContextMenu.vue';

interface EditorGizmo {
  id: string;
  label: string;
  coordinate: Coordinate;
  path?: string;
  lookup?: boolean;
  color?: string;
  visual?: string;
}

interface ProjectFile {
  path: string;
  name?: string;
}

const selene = useSelene();
let customVisualRegistries = new Set<string>();
const httpListeners = new Map<string, Set<(payload: Record<string, unknown>) => void>>();
function onEditorResponse(id: string, callback: (payload: Record<string, unknown>) => void): () => void {
  const listeners = httpListeners.get(id) ?? new Set();
  httpListeners.set(id, listeners);
  listeners.add(callback);
  const unsubscribe = selene.network.onPayload(id, callback);
  return () => {
    listeners.delete(callback);
    unsubscribe();
  };
}
function requestEditor(operation: string, payload: Record<string, unknown> = {}): void {
  void requestEditorOperation(selene, operation, payload)
    .then((result) => {
      const data = result as Record<string, unknown>;
      const deliver = (id: string, payload = data): void => {
        for (const listener of httpListeners.get(`moonlight-editor:${id}`) ?? []) {
          listener(payload);
        }
      };
      switch (operation) {
        case 'request-bundles':
          deliver('bundle-options');
          break;
        case 'request-bundle-registries':
          deliver('bundle-registry-options');
          break;
        case 'request-project':
          deliver('project-start');
          deliver('project-files');
          deliver('project-end');
          break;
        case 'search-registry':
          deliver('registry-options');
          if (typeof data.registry === 'string' && customVisualRegistries.has(data.registry)) {
            selene.network.sendToServer('moonlight-editor:resolve-registry-visuals', {
              registry: data.registry,
              values: (data.options as Array<{ value: string }>).map((entry) => entry.value),
            });
          }
          break;
        case 'open-file':
          deliver('file');
          break;
        case 'create-file':
          if (typeof data.path === 'string' && entries.value[data.path]?.draft) {
            deliver('error', { message: 'A local draft with this name already exists.' });
            break;
          }
          deliver('file', { ...data, draft: true });
          deliver('file-created');
          break;
        case 'save-file':
          deliver('file-saved');
          break;
        case 'pending-changes':
          deliver('pending-changes');
          break;
        case 'persist-changes':
          if (!data.error) {
            deliver('changes-persisted');
          }
          break;
        case 'discard-changes':
          if (!data.error) {
            deliver('changes-discarded');
          }
          break;
      }
      if (data.pendingChanges) {
        deliver('pending-changes', data.pendingChanges as Record<string, unknown>);
      }
      if (data.error) {
        deliver('error', { message: data.error });
      }
    })
    .catch((error: unknown) => {
      for (const listener of httpListeners.get('moonlight-editor:error') ?? []) {
        listener({ message: error instanceof Error ? error.message : String(error) });
      }
    });
}

const inlineForm = ref<{
  id: number;
  title: string;
  coordinate: Coordinate;
  schema: Record<string, SchemaDefinition>;
  fieldLabels?: Record<string, string>;
  contents: string;
} | null>(null);
const inlinePicking = ref(false);
const inlineSaving = ref(false);
const inlineMessage = ref('');
const inlineFormScale = 0.5;
const inlinePosition = computed(() => {
  void projectionRevision.value;
  const point = inlineForm.value ? selene.world.projectCoordinate(inlineForm.value.coordinate) : { x: 0, y: 0 };
  const width = Math.min(560, (window.innerWidth - 16) / inlineFormScale);
  const top = Math.max(8, Math.min(point.y, window.innerHeight - 320 * inlineFormScale));
  return {
    width: `${width}px`,
    left: `${Math.max(8, Math.min(point.x + 20, window.innerWidth - width * inlineFormScale - 8))}px`,
    top: `${top}px`,
    maxHeight: `${(window.innerHeight - top - 8) / inlineFormScale}px`,
    transform: `scale(${inlineFormScale})`,
  };
});
function refreshInlinePosition(): void {
  projectionRevision.value += 1;
}
function closeInlineForm(): void {
  if (inlineForm.value) {
    selene.network.sendToServer('moonlight-editor:close-inline-form', { id: inlineForm.value.id });
  }
  inlineForm.value = null;
  inlinePicking.value = false;
  releaseTextCapture?.();
  releaseTextCapture = undefined;
  releasePanelKeys?.();
  releasePanelKeys = undefined;
}
function clickGizmo(gizmo: EditorGizmo): void {
  if (pickingCoordinateField || pickingRegistry || pickingDistance.value) {
    finishCoordinatePicker(gizmo.coordinate);
  } else if (gizmo.lookup) {
    selene.network.sendToServer('moonlight-editor:lookup-coordinate', { ...gizmo.coordinate });
  } else if (gizmo.path) {
    openFile(gizmo.path);
  }
}
function saveInlineForm(): void {
  if (!inlineForm.value || inlineSaving.value) {
    return;
  }
  inlineSaving.value = true;
  selene.network.sendToServer('moonlight-editor:save-inline-form', {
    id: inlineForm.value.id,
    contents: inlineForm.value.contents,
  });
}
const connected = ref(false);
const enabled = ref(false);
const visible = ref(false);
const bundleOptions = ref<string[]>([]);
const bundleRegistries = ref<Record<string, string[]>>({});
const projectFiles = ref<ProjectFile[]>([]);
const SELECTION_STORAGE_KEY = 'moonlight-editor.selection';
function loadSelection(): { bundle: string; registry: string } {
  try {
    const selection: unknown = JSON.parse(window.localStorage.getItem(SELECTION_STORAGE_KEY) ?? 'null');
    if (
      typeof selection === 'object' &&
      selection !== null &&
      'bundle' in selection &&
      typeof selection.bundle === 'string' &&
      'registry' in selection &&
      typeof selection.registry === 'string'
    ) {
      return { bundle: selection.bundle, registry: selection.registry };
    }
  } catch {
    // Storage may be unavailable or contain invalid JSON.
  }
  return { bundle: '', registry: '' };
}
const savedSelection = loadSelection();
const selectedBundle = ref(savedSelection.bundle);
const selectedRegistry = ref(savedSelection.registry);
watch([selectedBundle, selectedRegistry], ([bundle, registry]) => {
  if (!bundle || !registry) {
    return;
  }
  try {
    window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify({ bundle, registry }));
  } catch {
    // Selection still works when browser storage is unavailable.
  }
});
const selectedPath = ref<string | null>(null);
const entries = ref<Record<string, { contents: string; appliedContents: string; draft?: boolean; registry?: string }>>(
  {},
);
const listedFiles = computed(() => {
  const drafts = Object.entries(entries.value)
    .filter(
      ([path, entry]) =>
        entry.draft && bundleFromPath(path) === selectedBundle.value && entry.registry === selectedRegistry.value,
    )
    .map(([path]) => ({ path }));
  return [
    ...projectFiles.value,
    ...drafts.filter(({ path }) => !projectFiles.value.some((file) => file.path === path)),
  ].sort((left, right) => left.path.localeCompare(right.path));
});
const applying = new Map<string, string>();
const contents = computed({
  get: () => (selectedPath.value ? (entries.value[selectedPath.value]?.contents ?? '') : ''),
  set: (value: string) => {
    if (selectedPath.value && entries.value[selectedPath.value]) {
      entries.value[selectedPath.value]!.contents = value;
    }
  },
});
const savedContents = computed(() =>
  selectedPath.value ? (entries.value[selectedPath.value]?.appliedContents ?? '') : '',
);
const localPaths = computed(() =>
  Object.entries(entries.value)
    .filter(([, entry]) => entry.contents !== entry.appliedContents)
    .map(([path]) => path),
);
const pendingChanges = ref(0);
const pendingPaths = ref<string[]>([]);
const confirmation = ref<'persist' | 'discard' | null>(null);
const resourcePermissions = ref({ apply: false, persist: false, discard: false, persistAll: false, discardAll: false });
let permissionRevision = 0;
async function refreshResourcePermissions(): Promise<void> {
  const revision = ++permissionRevision;
  resourcePermissions.value = { apply: false, persist: false, discard: false, persistAll: false, discardAll: false };
  if (!connected.value || !visible.value) {
    return;
  }
  const path = selectedPath.value;
  const target = path ? { path } : {};
  try {
    const result = await selene.http.request(
      '/resources/permissions',
      {
        checks: [
          { operation: 'save-file', request: { ...target, contents: contents.value } },
          { operation: 'persist-changes', request: target },
          { operation: 'discard-changes', request: target },
          { operation: 'persist-changes', request: {} },
          { operation: 'discard-changes', request: {} },
        ],
      },
      'POST',
    );
    if (revision !== permissionRevision || !Array.isArray(result) || result.length !== 5) {
      return;
    }
    resourcePermissions.value = {
      apply: path !== null && result[0] === true,
      persist: path !== null && result[1] === true,
      discard: path !== null && result[2] === true,
      persistAll: result[3] === true,
      discardAll: result[4] === true,
    };
  } catch (error: unknown) {
    if (revision === permissionRevision) {
      setStatus(`Permission check failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }
}
watch([selectedPath, selectedBundle, selectedRegistry, pendingPaths, connected, visible], () => {
  void refreshResourcePermissions();
});

const projectLoading = ref(false);
const schemaLoading = ref(false);
const fileLoading = ref(false);
const registrySchema = ref<Record<string, SchemaDefinition> | null>(null);
const registryOptions = ref<Record<string, Array<{ value: string; label: string; visual?: string }>>>({});
const registryQueries = new Map<string, string>();
const status = ref('Escape closes the file panel');
const statusIsError = ref(false);
const gizmos = ref<EditorGizmo[]>([]);
const cameraCoordinate = ref(selene.world.getCameraCoordinate());
const hoveredCoordinate = ref<Coordinate | null>(null);
const moveCameraLevel = (direction: number, event: MouseEvent) => {
  const coordinate = { ...cameraCoordinate.value };
  const offset = event.shiftKey ? 3 : 1;
  selene.network.sendToServer('moonlight-editor:move-camera', {
    ...coordinate,
    z: coordinate.z + direction * offset,
  });
};
const projectionRevision = ref(0);
const showTileGrid = ref(false);
let tileGridCheckRevision = 0;
function toggleTileGrid(): void {
  tileGridCheckRevision += 1;
  showTileGrid.value = !showTileGrid.value;
}
async function enableGridForEmptyLayer(coordinate: Coordinate): Promise<void> {
  const revision = ++tileGridCheckRevision;
  try {
    const hasTile = await selene.world.hasTileAt({ ...coordinate });
    if (enabled.value && revision === tileGridCheckRevision && !hasTile) {
      showTileGrid.value = true;
    }
  } catch (error) {
    console.warn('[Moonlight Editor] Could not check focus tile', error);
  }
}
watch([enabled, showTileGrid], ([active, visible]) => {
  void selene.world.setTileGridVisible(active && visible);
});
const pickingDistance = ref<DistancePick | null>(null);
const pickerActive = ref(false);
const distanceCircle = computed(() => {
  void projectionRevision.value;
  const pick = pickingDistance.value;
  if (!pick || pick.coordinate.z !== cameraCoordinate.value.z) {
    return null;
  }
  return {
    points: projectedCircle(pick.coordinate, pick.distance, selene.world.projectCoordinate),
    center: selene.world.projectCoordinate(pick.coordinate),
  };
});
const isDirty = computed(() => selectedPath.value !== null && contents.value !== savedContents.value);
const bundles = computed(() => [...bundleOptions.value].sort());
const registries = computed(() => bundleRegistries.value[selectedBundle.value] ?? []);
const projectedGizmos = computed(() => {
  void projectionRevision.value;
  return gizmos.value
    .filter(({ coordinate }) => coordinate.z === cameraCoordinate.value.z)
    .map((gizmo) => ({ ...gizmo, screen: selene.world.projectCoordinate(gizmo.coordinate) }));
});

const releases: Array<() => void> = [];
let releaseTextCapture: (() => void) | undefined;
let releasePanelKeys: (() => void) | undefined;
let releasePickerKeys: (() => void) | undefined;
let pickingCoordinateField: string | null = null;
let pickingRegistry: string | null = null;
let pickerCameraZ: number | null = null;
let suppressWorldPointer = false;
const dragging = ref(false);
let moved = false;
let lastRequested: Coordinate | null = null;
let dragClientX = 0;
let dragClientY = 0;
let dragCameraPosition: { x: number; y: number } | null = null;
let dragSequence = 0;
let cameraZoom = 1;
let dragRequestRevision = 0;
let zoomRequestRevision = 0;
const cameraRequests = latestRequest<Coordinate>((coordinate) => {
  if (enabled.value) {
    selene.network.sendToServer('moonlight-editor:move-camera', { ...coordinate });
  }
});
const zoomRequests = latestRequest<number>((zoom) => {
  if (enabled.value) {
    selene.network.sendToServer('moonlight-editor:zoom-camera', { zoom });
  }
});

function bundleFromPath(path: string): string {
  const dataDirectory = path.search(/\/(?:common|server)\/data\//);
  return dataDirectory === -1 ? path.split('/')[0]! : path.slice(0, dataDirectory);
}

function selectFirstRegistry(): void {
  selectedRegistry.value = registries.value[0] ?? '';
}

function isCurrentSelection(payload: ClientNetworkPayload): boolean {
  return payload.bundle === selectedBundle.value && payload.registry === selectedRegistry.value;
}

function setStatus(message: string, error = false): void {
  status.value = message;
  statusIsError.value = error;
}

function requestProject(): void {
  if (!selectedBundle.value || !selectedRegistry.value) {
    projectLoading.value = false;
    schemaLoading.value = false;
    return;
  }
  projectLoading.value = true;
  schemaLoading.value = true;
  projectFiles.value = [];
  registrySchema.value = null;
  setStatus(`Loading ${selectedRegistry.value} files…`);
  requestEditor('request-project', {
    bundle: selectedBundle.value,
    registry: selectedRegistry.value,
  });
  requestEditor('pending-changes');
}

function searchRegistry(registry: string, query: string, lookup = false): void {
  if (!lookup) {
    registryQueries.set(registry, query);
  }
  requestEditor('search-registry', { registry, query, lookup });
}

function requestBundles(): void {
  projectLoading.value = true;
  schemaLoading.value = true;
  requestEditor('request-bundles');
}

let lastGizmoCoordinate: Coordinate | null = null;
function requestGizmos(): void {
  lastGizmoCoordinate = { ...cameraCoordinate.value };
  selene.network.sendToServer('moonlight-editor:request-gizmos', { ...lastGizmoCoordinate });
}

function requestBundleRegistries(): void {
  if (!selectedBundle.value) {
    requestProject();
    return;
  }
  projectLoading.value = true;
  schemaLoading.value = true;
  requestEditor('request-bundle-registries', { bundle: selectedBundle.value });
}

function selectBundle(): void {
  selectedPath.value = null;
  selectedRegistry.value = '';
  projectFiles.value = [];
  registrySchema.value = null;
  requestBundleRegistries();
}

function selectRegistry(): void {
  selectedPath.value = null;
  requestProject();
}

function setProjectVisible(show: boolean): void {
  if (show) {
    closeInlineForm();
  }
  visible.value = show;
  if (!show) {
    confirmation.value = null;
  }
  if (show) {
    releaseTextCapture ??= selene.input.captureText();
    releasePanelKeys ??= selene.input.captureKeys('Escape');
    if (connected.value) {
      if (bundleOptions.value.length === 0) {
        requestBundles();
      } else {
        requestBundleRegistries();
      }
    }
  } else {
    releaseTextCapture?.();
    releaseTextCapture = undefined;
    releasePanelKeys?.();
    releasePanelKeys = undefined;
  }
}

function openFile(path: string): void {
  fileLoading.value = true;
  setStatus(`Opening ${path}…`);
  const draft = entries.value[path];
  if (draft?.draft) {
    receiveFile({ path, contents: draft.contents, draft: true, registry: draft.registry });
    return;
  }
  requestEditor('open-file', { path });
}

function createFile(name: string, duplicate = false): void {
  if (!selectedBundle.value || !selectedRegistry.value || fileLoading.value || projectLoading.value) {
    return;
  }
  fileLoading.value = true;
  setStatus('Creating entry…');
  requestEditor('create-file', {
    name,
    bundle: duplicate && selectedPath.value ? bundleFromPath(selectedPath.value) : selectedBundle.value,
    registry: selectedRegistry.value,
    namespace: (duplicate && selectedPath.value ? selectedPath.value : projectFiles.value[0]?.path)?.match(
      /\/(?:common|server)\/data\/([^/]+)\//,
    )?.[1],
    ...(duplicate ? { sourcePath: selectedPath.value, contents: contents.value } : {}),
  });
}

function save(): void {
  if (!selectedPath.value || !isDirty.value || !resourcePermissions.value.apply) {
    return;
  }
  if (applying.has(selectedPath.value)) {
    return;
  }
  applying.set(selectedPath.value, contents.value);
  requestEditor('save-file', {
    path: selectedPath.value,
    contents: contents.value,
  });
  setStatus('Saving…');
}

function discardLocalChanges(): void {
  if (selectedPath.value && entries.value[selectedPath.value]?.draft) {
    delete entries.value[selectedPath.value];
    selectedPath.value = null;
    setStatus('Local draft discarded');
    return;
  }
  contents.value = savedContents.value;
  setStatus('Local changes discarded');
}

function persistChanges(path?: string): void {
  if (
    pendingChanges.value === 0 ||
    !(path ? resourcePermissions.value.persist : resourcePermissions.value.persistAll)
  ) {
    return;
  }
  requestEditor('persist-changes', path ? { path } : {});
  setStatus('Persisting changes…');
}

function discardChanges(path?: string): void {
  if (
    pendingChanges.value === 0 ||
    !(path ? resourcePermissions.value.discard : resourcePermissions.value.discardAll)
  ) {
    return;
  }
  requestEditor('discard-changes', path ? { path } : {});
  setStatus('Discarding changes…');
}

function finishCoordinatePicker(coordinate?: Coordinate): void {
  const field = pickingCoordinateField;
  const scope = pickingRegistry;
  const distance = pickingDistance.value;
  if (!field && !scope && !distance) {
    return;
  }
  if (coordinate && scope) {
    selene.network.sendToServer('moonlight-editor:lookup-coordinate', { ...coordinate, scope });
    return;
  }
  const targetField = distance?.field ?? field;
  if (coordinate && targetField && (!distance || coordinate.z === distance.coordinate.z)) {
    try {
      const value: unknown = JSON.parse(
        inlinePicking.value && inlineForm.value ? inlineForm.value.contents : contents.value,
      );
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        let object = value as Record<string, unknown>;
        const path = targetField.split('.');
        for (const key of path.slice(0, -1)) {
          const child = object[key];
          const nested = child !== null && typeof child === 'object' ? child : {};
          object[key] = nested;
          object = nested as Record<string, unknown>;
        }
        object[path[path.length - 1]!] = distance ? pickedDistance(distance, coordinate) : { ...coordinate };
        const updated = `${JSON.stringify(value, null, 2)}\n`;
        if (inlinePicking.value && inlineForm.value) {
          inlineForm.value.contents = updated;
        } else {
          contents.value = updated;
        }
      }
    } catch {
      setStatus('Fix the JSON before picking a coordinate', true);
    }
  }
  releasePickerKeys?.();
  releasePickerKeys = undefined;
  pickingCoordinateField = null;
  pickingRegistry = null;
  pickingDistance.value = null;
  pickerActive.value = false;
  if (pickerCameraZ !== null) {
    const coordinate = selene.world.getCameraCoordinate();
    if (coordinate.z !== pickerCameraZ) {
      selene.network.sendToServer('moonlight-editor:move-camera', { ...coordinate, z: pickerCameraZ });
    }
    pickerCameraZ = null;
  }
  suppressWorldPointer = true;
  window.setTimeout(() => {
    suppressWorldPointer = false;
  });
  if (inlinePicking.value) {
    inlinePicking.value = false;
    releaseTextCapture ??= selene.input.captureText();
    releasePanelKeys ??= selene.input.captureKeys('Escape');
  } else {
    setProjectVisible(true);
  }
}

function startCoordinatePicker(field: string): void {
  pickingCoordinateField = field;
  startPicker('Click a tile to pick its coordinate; Escape cancels');
}

function startDistancePicker(pick: DistancePick): void {
  pickingDistance.value = { ...pick, coordinate: { ...pick.coordinate } };
  startPicker('Move to preview the radius; click to set distance; Escape cancels');
  selene.network.sendToServer('moonlight-editor:move-camera', { ...pick.coordinate });
}

function startRegistryPicker(): void {
  if (!selectedRegistry.value) {
    return;
  }
  pickingRegistry = selectedRegistry.value;
  startPicker(`Click a tile to pick a ${pickingRegistry} resource; Escape cancels`);
}

function startPicker(message: string): void {
  pickerCameraZ = selene.world.getCameraCoordinate().z;
  pickerActive.value = true;
  inlinePicking.value = inlineForm.value !== null;
  setProjectVisible(false);
  releasePickerKeys = selene.input.captureKeys('Escape');
  setStatus(message);
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && event.target instanceof Element && event.target.closest('dialog[open]')) {
    return;
  }
  if ((pickingCoordinateField || pickingRegistry || pickingDistance.value) && event.key === 'Escape' && !event.repeat) {
    event.preventDefault();
    finishCoordinatePicker();
  } else if (inlineForm.value && event.key === 'Escape' && !event.repeat) {
    event.preventDefault();
    closeInlineForm();
  } else if (inlineForm.value && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveInlineForm();
  } else if (confirmation.value && event.key === 'Escape' && !event.repeat) {
    event.preventDefault();
    confirmation.value = null;
  } else if (visible.value && event.key === 'Escape' && !event.repeat) {
    event.preventDefault();
    setProjectVisible(false);
  } else if (event.key === 'F1' && !event.repeat) {
    event.preventDefault();
    selene.network.sendToServer('moonlight-editor:toggle');
  } else if (visible.value && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!confirmation.value) {
      save();
    }
  }
}

function receiveProjectFiles(payload: ClientNetworkPayload): void {
  if (isCurrentSelection(payload) && Array.isArray(payload.files)) {
    projectFiles.value.push(
      ...payload.files.filter(
        (file): file is ProjectFile =>
          typeof file === 'object' &&
          file !== null &&
          typeof (file as Record<string, unknown>).path === 'string' &&
          (typeof (file as Record<string, unknown>).name === 'string' ||
            (file as Record<string, unknown>).name === undefined),
      ),
    );
  }
}

function receiveBundleOptions(payload: ClientNetworkPayload): void {
  if (!Array.isArray(payload.bundles)) {
    return;
  }
  bundleOptions.value = payload.bundles.filter((bundle): bundle is string => typeof bundle === 'string');
  if (!bundles.value.includes(selectedBundle.value)) {
    selectedBundle.value = bundles.value[0] ?? '';
    selectedRegistry.value = '';
  }
  requestBundleRegistries();
}

function receiveBundleRegistries(payload: ClientNetworkPayload): void {
  if (typeof payload.bundle !== 'string' || !Array.isArray(payload.registries)) {
    return;
  }
  bundleRegistries.value[payload.bundle] = payload.registries
    .filter((registry): registry is string => typeof registry === 'string').sort();
  if (payload.bundle !== selectedBundle.value) {
    return;
  }
  if (!registries.value.includes(selectedRegistry.value)) {
    selectFirstRegistry();
  }
  requestProject();
}

function receiveGizmos(payload: ClientNetworkPayload): void {
  if (!Array.isArray(payload.gizmos)) {
    return;
  }
  for (const value of payload.gizmos) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    const gizmo = value as Record<string, unknown>;
    const coordinate = gizmo.coordinate as Record<string, unknown> | null;
    if (
      typeof gizmo.id === 'string' &&
      typeof gizmo.label === 'string' &&
      typeof coordinate === 'object' &&
      coordinate !== null &&
      typeof coordinate.x === 'number' &&
      typeof coordinate.y === 'number' &&
      typeof coordinate.z === 'number'
    ) {
      gizmos.value.push({
        id: gizmo.id,
        label: gizmo.label,
        coordinate: { x: coordinate.x, y: coordinate.y, z: coordinate.z },
        lookup: gizmo.lookup === true,
        path: typeof gizmo.path === 'string' ? gizmo.path : undefined,
        color: typeof gizmo.color === 'string' ? gizmo.color : undefined,
        visual: typeof gizmo.visual === 'string' ? gizmo.visual : undefined,
      });
    }
  }
}

function receiveFile(payload: ClientNetworkPayload): void {
  if (typeof payload.path !== 'string' || typeof payload.contents !== 'string') {
    return;
  }
  if (pickingRegistry || pickingDistance.value) {
    finishCoordinatePicker();
  }
  const previousBundle = selectedBundle.value;
  const previousRegistry = selectedRegistry.value;
  const wasVisible = visible.value;
  fileLoading.value = false;
  selectedPath.value = payload.path;
  selectedBundle.value = bundleFromPath(payload.path);
  selectedRegistry.value = typeof payload.registry === 'string' ? payload.registry : selectedRegistry.value;
  const entry = entries.value[payload.path];
  const localContents = entry && entry.contents !== entry.appliedContents ? entry.contents : payload.contents;
  entries.value[payload.path] = {
    contents: localContents,
    appliedContents: payload.draft === true ? '' : payload.contents,
    draft: payload.draft === true,
    registry: selectedRegistry.value,
  };
  if (!wasVisible) {
    setProjectVisible(true);
  } else if (selectedBundle.value !== previousBundle) {
    requestBundleRegistries();
  } else if (selectedRegistry.value !== previousRegistry) {
    requestProject();
  }
  setStatus('File loaded');
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('resize', refreshInlinePosition);
  releases.push(
    selene.input.captureKeys('F1'),
    onEditorResponse('moonlight-editor:resource-path', (payload) => {
      if (typeof payload.path === 'string') {
        openFile(payload.path);
      }
    }),
    onEditorResponse('moonlight-editor:editor-state', (payload) => {
      customVisualRegistries = new Set(
        Array.isArray(payload.visualRegistries)
          ? payload.visualRegistries.filter((registry): registry is string => typeof registry === 'string')
          : [],
      );
      if (payload.enabled === true) {
        requestEditor('pending-changes');
      }
      tileGridCheckRevision += 1;
      enabled.value = payload.enabled === true;
      if (enabled.value) {
        selene.network.sendToServer('moonlight-editor:zoom-camera', { zoom: cameraZoom });
        requestGizmos();
      } else {
        gizmos.value = [];
      }
      if (!enabled.value) {
        cameraRequests.cancel();
        zoomRequests.cancel();
        zoomRequestRevision += 1;
        if (cameraZoom !== 1) {
          cameraZoom = 1;
          void selene.world.setCameraZoom(1);
        }
        releasePickerKeys?.();
        releasePickerKeys = undefined;
        pickingCoordinateField = null;
        pickingRegistry = null;
        pickingDistance.value = null;
        pickerActive.value = false;
        pickerCameraZ = null;
        closeInlineForm();
        setProjectVisible(false);
        dragging.value = false;
        lastRequested = null;
        dragCameraPosition = null;
        dragSequence += 1;
      }
    }),
    onEditorResponse('moonlight-editor:project-start', (payload) => {
      if (isCurrentSelection(payload)) {
        projectFiles.value = [];
        registrySchema.value =
          typeof payload.schema === 'object' && payload.schema !== null && !Array.isArray(payload.schema)
            ? (payload.schema as Record<string, SchemaDefinition>)
            : null;
        schemaLoading.value = false;
      }
    }),
    onEditorResponse('moonlight-editor:bundle-options', receiveBundleOptions),
    onEditorResponse('moonlight-editor:bundle-registry-options', receiveBundleRegistries),
    onEditorResponse('moonlight-editor:project-files', receiveProjectFiles),
    onEditorResponse('moonlight-editor:project-end', (payload) => {
      if (isCurrentSelection(payload)) {
        projectLoading.value = false;
        setStatus(`${projectFiles.value.length} data files`);
      }
    }),
    onEditorResponse('moonlight-editor:inline-form', (payload) => {
      if (
        !enabled.value ||
        typeof payload.id !== 'number' ||
        typeof payload.contents !== 'string' ||
        typeof payload.schema !== 'object' ||
        payload.schema === null ||
        Array.isArray(payload.schema)
      ) {
        return;
      }
      const coordinate = payload.coordinate as Coordinate | undefined;
      if (!coordinate || !['x', 'y', 'z'].every((axis) => typeof coordinate[axis as keyof Coordinate] === 'number')) {
        return;
      }
      closeInlineForm();
      setProjectVisible(false);
      inlineForm.value = {
        id: payload.id,
        title: typeof payload.title === 'string' ? payload.title : 'Edit coordinate',
        coordinate,
        schema: payload.schema as Record<string, SchemaDefinition>,
        fieldLabels:
          typeof payload.fieldLabels === 'object' && payload.fieldLabels !== null
            ? (payload.fieldLabels as Record<string, string>)
            : undefined,
        contents: payload.contents,
      };
      inlineSaving.value = false;
      inlineMessage.value = '';
      releaseTextCapture ??= selene.input.captureText();
      releasePanelKeys ??= selene.input.captureKeys('Escape');
    }),
    onEditorResponse('moonlight-editor:inline-form-saved', (payload) => {
      if (payload.id !== inlineForm.value?.id) {
        return;
      }
      inlineSaving.value = false;
      inlineMessage.value = typeof payload.message === 'string' ? payload.message : '';
      if (payload.success === true) {
        requestGizmos();
      }
    }),
    onEditorResponse('moonlight-editor:file', receiveFile),
    onEditorResponse('moonlight-editor:file-created', (payload) => {
      if (isCurrentSelection(payload)) {
        requestProject();
      }
    }),
    onEditorResponse('moonlight-editor:registry-visuals', (payload) => {
      if (typeof payload.registry !== 'string' || !payload.visuals || typeof payload.visuals !== 'object') {
        return;
      }
      const visuals = payload.visuals as Record<string, string>;
      registryOptions.value[payload.registry] = (registryOptions.value[payload.registry] ?? []).map((option) => ({
        ...option,
        visual: visuals[option.value] ?? option.visual,
      }));
    }),
    onEditorResponse('moonlight-editor:registry-options', (payload) => {
      if (
        typeof payload.registry !== 'string' ||
        typeof payload.query !== 'string' ||
        !Array.isArray(payload.options)
      ) {
        return;
      }
      if (payload.lookup !== true && registryQueries.get(payload.registry) !== payload.query) {
        return;
      }
      registryOptions.value = {
        ...registryOptions.value,
        [payload.registry]: [
          ...(payload.lookup === true ? (registryOptions.value[payload.registry] ?? []) : []),
          ...payload.options.filter(
            (option): option is { value: string; label: string; visual?: string } =>
              typeof option === 'object' &&
              option !== null &&
              typeof (option as Record<string, unknown>).value === 'string' &&
              typeof (option as Record<string, unknown>).label === 'string' &&
              (typeof (option as Record<string, unknown>).visual === 'string' ||
                (option as Record<string, unknown>).visual === undefined),
          ),
        ].filter(
          (option, index, options) => options.findIndex((candidate) => candidate.value === option.value) === index,
        ),
      };
    }),
    onEditorResponse('moonlight-editor:file-saved', (payload) => {
      if (typeof payload.path !== 'string') {
        return;
      }
      const appliedContents = applying.get(payload.path);
      applying.delete(payload.path);
      const entry = entries.value[payload.path];
      if (entry && appliedContents !== undefined) {
        const wasDraft = entry.draft;
        entry.appliedContents = appliedContents;
        entry.draft = false;
        if (wasDraft) {
          requestProject();
        }
      }
      if (payload.path === selectedPath.value) {
        setStatus('Applied');
      }
    }),
    onEditorResponse('moonlight-editor:pending-changes', (payload) => {
      if (typeof payload.count === 'number' && Number.isInteger(payload.count) && payload.count >= 0) {
        pendingChanges.value = payload.count;
        pendingPaths.value = Array.isArray(payload.paths)
          ? payload.paths.filter((path): path is string => typeof path === 'string').sort()
          : [];
        if (payload.count === 0) {
          confirmation.value = null;
        }
      }
    }),
    onEditorResponse('moonlight-editor:changes-persisted', (payload) => {
      const removedPaths = Array.isArray(payload.removedPaths) ? payload.removedPaths : [];
      for (const path of removedPaths) {
        if (typeof path === 'string') {
          delete entries.value[path];
          applying.delete(path);
        }
      }
      if (selectedPath.value && removedPaths.includes(selectedPath.value)) {
        selectedPath.value = null;
      }
      if (removedPaths.length > 0) {
        requestProject();
      }
      setStatus('Changes persisted');
    }),
    onEditorResponse('moonlight-editor:changes-discarded', (payload) => {
      setStatus('Changes discarded');
      const removedPaths = Array.isArray(payload.removedPaths) ? payload.removedPaths : [];
      for (const path of removedPaths) {
        if (typeof path === 'string') {
          delete entries.value[path];
          applying.delete(path);
        }
      }
      if (selectedPath.value && removedPaths.includes(selectedPath.value)) {
        selectedPath.value = null;
      }
      if (removedPaths.length > 0) {
        requestProject();
      }
      if (selectedPath.value && (payload.path === undefined || payload.path === selectedPath.value)) {
        openFile(selectedPath.value);
      }
    }),
    onEditorResponse('moonlight-editor:error', (payload) => {
      if (inlineSaving.value) {
        inlineSaving.value = false;
        inlineMessage.value = String(payload.message ?? 'Editor error');
      }
      projectLoading.value = false;
      schemaLoading.value = false;
      fileLoading.value = false;
      applying.clear();
      setStatus(String(payload.message ?? 'Editor error'), true);
    }),
    onEditorResponse('moonlight-editor:gizmos-start', () => {
      gizmos.value = [];
    }),
    onEditorResponse('moonlight-editor:gizmos', receiveGizmos),
    onEditorResponse('moonlight-editor:gizmos-end', () => {
      projectionRevision.value += 1;
    }),
    selene.network.onConnected(() => {
      connected.value = true;
      selene.network.sendToServer('moonlight-editor:request-state');
      if (visible.value) {
        requestBundles();
      }
    }),
    selene.input.onScroll(({ amountY }) => {
      if (!enabled.value || dragging.value || !Number.isFinite(amountY) || amountY === 0) {
        return;
      }
      cameraZoom = Math.min(1, Math.max(0.28, cameraZoom * Math.pow(1.1, -amountY)));
      const zoom = cameraZoom;
      const revision = ++zoomRequestRevision;
      void selene.world.setCameraZoom(zoom).then((appliedZoom) => {
        if (!enabled.value || revision !== zoomRequestRevision) {
          return;
        }
        zoomRequests.push(appliedZoom);
        projectionRevision.value += 1;
      });
    }),
    selene.input.onPointerDown((event) => {
      if (!enabled.value || event.button !== 0 || suppressWorldPointer) {
        return;
      }
      cameraRequests.cancel();
      dragging.value = true;
      moved = false;
      lastRequested = selene.world.getCameraCoordinate();
      dragClientX = event.clientX;
      dragClientY = event.clientY;
      dragCameraPosition = null;
      const sequence = ++dragSequence;
      void selene.world.getCameraPosition().then((position) => {
        if (dragging.value && dragSequence === sequence) {
          dragCameraPosition = position;
        }
      });
    }),
    selene.input.onPointerMove((event) => {
      hoveredCoordinate.value = enabled.value ? { ...event.coordinate } : null;
      const pick = pickingDistance.value;
      if (enabled.value && pick && event.coordinate.z === pick.coordinate.z) {
        pick.distance = pickedDistance(pick, event.coordinate);
      }
      if (!enabled.value || !dragging.value) {
        return;
      }
      moved ||= Math.hypot(event.clientX - dragClientX, event.clientY - dragClientY) > 4;
      if (dragCameraPosition && moved) {
        const sequence = dragSequence;
        const revision = ++dragRequestRevision;
        void selene.world
          .setCameraPosition({
            x: dragCameraPosition.x - (event.clientX - dragClientX) / cameraZoom,
            y: dragCameraPosition.y - (event.clientY - dragClientY) / cameraZoom,
          })
          .then((coordinate) => {
            projectionRevision.value += 1;
            if (
              !dragging.value ||
              sequence !== dragSequence ||
              revision !== dragRequestRevision ||
              (lastRequested &&
                coordinate.x === lastRequested.x &&
                coordinate.y === lastRequested.y &&
                coordinate.z === lastRequested.z)
            ) {
              return;
            }
            lastRequested = coordinate;
            cameraRequests.push({ ...coordinate });
          });
      }
    }),
    selene.input.onPointerUp((event) => {
      if (event.button !== 0 || !dragging.value) {
        return;
      }
      moved ||= Math.hypot(event.clientX - dragClientX, event.clientY - dragClientY) > 4;
      if (!moved && enabled.value && !suppressWorldPointer) {
        if (pickingCoordinateField || pickingRegistry || pickingDistance.value) {
          if (!pickingDistance.value || event.coordinate.z === pickingDistance.value.coordinate.z) {
            finishCoordinatePicker(event.coordinate);
          }
        } else {
          selene.network.sendToServer('moonlight-editor:lookup-coordinate', { ...event.coordinate });
        }
      }
      // Apply the release position even if the last pointer-move promise is still pending.
      const origin = dragCameraPosition;
      const sequence = ++dragSequence;
      cameraRequests.cancel();
      if (origin && moved && enabled.value) {
        void selene.world
          .setCameraPosition({
            x: origin.x - (event.clientX - dragClientX) / cameraZoom,
            y: origin.y - (event.clientY - dragClientY) / cameraZoom,
          })
          .then((coordinate) => {
            if (!enabled.value || sequence !== dragSequence) {
              return;
            }
            cameraRequests.push({ ...coordinate });
            cameraRequests.flush();
          });
      }
      dragging.value = false;
      lastRequested = null;
      dragCameraPosition = null;
    }),
    selene.world.onCameraCoordinateChanged((coordinate) => {
      const changedLayer = coordinate.z !== cameraCoordinate.value.z;
      tileGridCheckRevision += 1;
      cameraCoordinate.value = coordinate;
      if (enabled.value && changedLayer) {
        void enableGridForEmptyLayer(coordinate);
      }
      if (
        enabled.value &&
        (!lastGizmoCoordinate ||
          coordinate.z !== lastGizmoCoordinate.z ||
          Math.abs(coordinate.x - lastGizmoCoordinate.x) >= 16 ||
          Math.abs(coordinate.y - lastGizmoCoordinate.y) >= 16)
      ) {
        requestGizmos();
      }
      projectionRevision.value += 1;
    }),
    selene.world.onMapChanged(() => {
      projectionRevision.value += 1;
    }),
  );
});

onBeforeUnmount(() => {
  cameraRequests.cancel();
  zoomRequests.cancel();
  dragSequence += 1;
  zoomRequestRevision += 1;
  tileGridCheckRevision += 1;
  void selene.world.setTileGridVisible(false);
  if (cameraZoom !== 1) {
    void selene.world.setCameraZoom(1);
    selene.network.sendToServer('moonlight-editor:zoom-camera', { zoom: 1 });
  }
  closeInlineForm();
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('resize', refreshInlinePosition);
  releaseTextCapture?.();
  releasePanelKeys?.();
  releasePickerKeys?.();
  releases.reverse().forEach((release) => release());
});
</script>

<template>
  <div v-if="enabled && !visible && hoveredCoordinate" class="hovered-coordinate" aria-label="Hovered coordinates">
    X: {{ hoveredCoordinate.x }} · Y: {{ hoveredCoordinate.y }} · Z: {{ hoveredCoordinate.z }}
  </div>
  <ContextMenu v-if="enabled && !visible && !inlineForm && !pickingDistance && !pickingCoordinateField && !pickingRegistry" />
  <nav v-if="enabled && !visible && !pickingDistance" class="actions" aria-label="Editor actions">
    <button
      type="button"
      title="Camera up 1 level (Shift: 3 levels)"
      aria-label="Camera up"
      @click="moveCameraLevel(1, $event)"
    >
      <ArrowUp :size="16" aria-hidden="true" />
    </button>
    <button
      type="button"
      title="Camera down 1 level (Shift: 3 levels)"
      aria-label="Camera down"
      @click="moveCameraLevel(-1, $event)"
    >
      <ArrowDown :size="16" aria-hidden="true" />
    </button>
    <button
      type="button"
      title="Focus Character"
      @click="selene.network.sendToServer('moonlight-editor:focus-character')"
    >
      <Focus :size="16" aria-hidden="true" />
      Focus Character
    </button>
    <GoToMenu />
    <button
      type="button"
      title="Show tile grid on the current z layer"
      :aria-pressed="showTileGrid"
      @click="toggleTileGrid"
    >
      <Grid2X2 :size="16" aria-hidden="true" />
      Toggle Grid
    </button>
    <button type="button" @click="setProjectVisible(true)">
        <Database :size="16" aria-hidden="true" />
        Registry Editor
    </button>
  </nav>
  <div v-if="enabled && !pickerActive" class="gizmos">
    <button
      v-for="gizmo in projectedGizmos"
      :key="gizmo.id"
      class="gizmo"
      :class="{ interactive: (gizmo.path || gizmo.lookup) && !pickingDistance && !dragging }"
      :style="{ left: `${gizmo.screen.x}px`, top: `${gizmo.screen.y}px`, '--gizmo-color': gizmo.color ?? '#f29d49' }"
      :title="gizmo.label"
      :disabled="(!gizmo.path && !gizmo.lookup) || !!pickingDistance"
      @click.stop="clickGizmo(gizmo)"
    >
      <span class="gizmo-marker">
        <GizmoVisual v-if="gizmo.visual" :identifier="gizmo.visual" />
      </span>
      <span class="gizmo-label">{{ gizmo.label }}</span>
    </button>
  </div>
  <svg v-if="enabled && distanceCircle" class="distance-preview" aria-hidden="true">
    <polygon :points="distanceCircle.points" />
    <circle :cx="distanceCircle.center.x" :cy="distanceCircle.center.y" r="4" />
  </svg>
  <div v-if="enabled && pickingDistance" class="distance-status" role="status">
    <strong>{{ pickingDistance.field }}: {{ pickingDistance.distance }} tiles</strong>
    <button type="button" @click="finishCoordinatePicker()">Cancel</button>
  </div>
  <section
    v-if="inlineForm && !inlinePicking && inlineForm.coordinate.z === cameraCoordinate.z"
    class="inline-modal"
    :style="inlinePosition"
    role="dialog"
    :aria-label="inlineForm.title"
    @pointerdown.stop
    @pointerup.stop
    @click.stop
  >
    <header>
      <strong>{{ inlineForm.title }}</strong
      ><button class="inline-close" type="button" aria-label="Close" @click="closeInlineForm">×</button>
    </header>
    <SchemaForm
      :schema="inlineForm.schema"
      :field-labels="inlineForm.fieldLabels"
      :contents="inlineForm.contents"
      :registry-options="registryOptions"
      @update-contents="inlineForm.contents = $event"
      @search-registry="searchRegistry"
      @pick-coordinate="startCoordinatePicker"
      @pick-distance="startDistancePicker"
    />
    <footer>
      <span role="status">{{ inlineMessage }}</span
      ><button type="button" :disabled="inlineSaving" @click="saveInlineForm">
        {{ inlineSaving ? 'Applying…' : 'Apply' }}
      </button>
    </footer>
  </section>
  <FileModal
    v-show="visible"
    v-model:selected-bundle="selectedBundle"
    v-model:selected-registry="selectedRegistry"
    v-model:contents="contents"
    :bundles="bundles"
    :registries="registries"
    :project-files="listedFiles"
    :project-loading="projectLoading"
    :editor-loading="fileLoading || schemaLoading"
    :selected-path="selectedPath"
    :is-dirty="isDirty"
    :permissions="resourcePermissions"
    :pending-changes="pendingChanges"
    :pending-paths="pendingPaths"
    :local-paths="localPaths"
    v-model:confirmation="confirmation"
    :status="status"
    :status-is-error="statusIsError"
    :schema="registrySchema"
    :registry-options="registryOptions"
    @select-bundle="selectBundle"
    @request-project="selectRegistry"
    @open-file="openFile"
    @search-registry="searchRegistry"
    @pick-coordinate="startCoordinatePicker"
    @pick-distance="startDistancePicker"
    @pick-resource="startRegistryPicker"
    @create-file="createFile"
    @duplicate-file="createFile($event, true)"
    @save="save"
    @discard-local="discardLocalChanges"
    @persist="persistChanges"
    @discard="discardChanges"
    @close="setProjectVisible(false)"
  />
</template>

<style scoped>
.inline-modal {
  position: fixed;
  z-index: 1000;
  transform-origin: top left;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  box-sizing: border-box;
  color: #e4e4e7;
  background: #18181b;
  border: 1px solid #3f3f46;
  border-radius: 8px;
  box-shadow: 0 18px 60px #000b;
  pointer-events: auto;
  font: inherit;
}
.inline-modal header,
.inline-modal footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
}
.inline-modal header {
  border-bottom: 1px solid rgba(212, 212, 216, 0.14);
}
.inline-modal footer {
  border-top: 1px solid rgba(212, 212, 216, 0.14);
  color: #a1a1aa;
}
.inline-modal footer span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.inline-modal :deep(.schema-form) {
  overflow: visible;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.inline-modal > :deep(.schema-form) {
  overflow: auto;
}
/* Keep suggestion lists in the scrollable form so neither nested sections nor
   the panel edge can clip them. Applies to script and registry dropdowns. */
.inline-modal :deep(.options) {
  position: relative;
  inset: auto;
  margin-top: 4px;
}
.inline-modal :deep(.coordinate-input) {
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto auto;
}
.inline-modal :deep(.coordinate-input label),
.inline-modal :deep(.coordinate-input input) {
  min-width: 0;
}
.inline-modal button {
  flex: none;
  padding: 5px 13px;
  border: 1px solid rgba(251, 113, 133, 0.42);
  border-radius: 6px;
  color: #ffe4e6;
  background: rgba(251, 113, 133, 0.14);
  font: inherit;
  cursor: pointer;
}
.inline-modal .inline-close {
  border-color: rgba(212, 212, 216, 0.22);
  color: #d4d4d8;
  background: #27272a;
}
.inline-modal button:hover:not(:disabled),
.inline-modal button:focus-visible {
  border-color: rgba(251, 113, 133, 0.42);
  outline: none;
  color: #ffe4e6;
  background: rgba(251, 113, 133, 0.24);
}
.inline-modal button:disabled {
  opacity: 0.5;
  cursor: default;
}
@media (max-width: 480px) {
  .inline-modal :deep(.schema-form) {
    grid-template-columns: minmax(0, 1fr);
  }
  .inline-modal :deep(.coordinate-input) {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }
  .inline-modal :deep(.coordinate-input label) {
    grid-column: 1;
  }
  .inline-modal :deep(.pick-coordinate),
  .inline-modal :deep(.view-coordinate) {
    grid-row: 1 / 4;
  }
  .inline-modal :deep(.pick-coordinate) {
    grid-column: 2;
  }
  .inline-modal :deep(.view-coordinate) {
    grid-column: 3;
  }
}

:global(:host) {
  color: #e4e4e7;
  font:
    13px/1.4 Inter,
    system-ui,
    sans-serif;
}
.gizmos {
  position: fixed;
  /* Keep world gizmos below moonlight-admin's menu layer (800). */
  z-index: 700;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.hovered-coordinate {
  position: fixed;
  z-index: 950;
  top: 12px;
  left: 12px;
  padding: 6px 10px;
  border: 1px solid rgba(212, 212, 216, 0.2);
  border-radius: 8px;
  color: #e4e4e7;
  background: rgba(24, 24, 27, 0.9);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.actions button[aria-pressed='true'] {
  background: #3f3f46;
  border-color: #f29d49;
}
.distance-preview {
  position: fixed;
  z-index: 910;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.distance-preview polygon {
  fill: #fb718530;
  stroke: #fb7185;
  stroke-width: 2;
}
.distance-preview circle {
  fill: #fff;
  stroke: #fb7185;
  stroke-width: 2;
}
.distance-status {
  position: fixed;
  z-index: 950;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid #fb7185;
  border-radius: 8px;
  color: #fafafa;
  background: #18181bef;
}
.distance-status button {
  padding: 5px 10px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  color: #fafafa;
  background: #27272a;
  cursor: pointer;
}
.actions {
  display: flex;
  gap: 5px;
  position: fixed;
  z-index: 950;
  top: 12px;
  right: 12px;
  padding: 5px;
  border: 1px solid rgba(212, 212, 216, 0.2);
  border-radius: 8px;
  background: rgba(24, 24, 27, 0.9);
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 24px #0008;
  pointer-events: auto;
}
.actions button {
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
.actions button:hover,
.actions button:focus-visible {
  outline: none;
  background: rgba(251, 113, 133, 0.24);
}
.gizmo {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 6px;
  /* Center the 26px marker after the button's 6px left padding. */
  transform: translate(-19px, -50%);
  border: 0;
  border-radius: 10px;
  color: #fafafa;
  background: rgba(24, 24, 27, 0.9);
  font: inherit;
  white-space: nowrap;
  pointer-events: none;
}
.gizmo.interactive {
  cursor: pointer;
  pointer-events: auto;
}
.gizmo-marker {
  position: relative;
  box-sizing: border-box;
  width: 26px;
  height: 26px;
  flex: none;
  border: 2px solid #fff;
  border-radius: 50%;
  background: var(--gizmo-color);
  box-shadow: 0 0 0 2px #0008;
  overflow: hidden;
}
.gizmo-label {
  display: none;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}
.gizmo:hover .gizmo-label,
.gizmo:focus-visible .gizmo-label {
  display: block;
}
</style>
