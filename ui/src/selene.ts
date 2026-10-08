import { inject, type InjectionKey } from 'vue';

export type ClientNetworkPayload = Record<string, unknown>;

export interface Coordinate {
  x: number;
  y: number;
  z: number;
}

export interface SelenePointerEvent {
  clientX: number;
  clientY: number;
  button: number;
  coordinate: Coordinate;
}

export interface SeleneUiApi {
  readonly http: {
    request(path: string, payload?: ClientNetworkPayload, method?: 'GET' | 'POST' | 'PUT'): Promise<unknown>;
  };
  readonly resolveAsset: (path: string) => Promise<string>;
  readonly visuals: {
    getDefinition(identifier: string): Promise<VisualDefinition>;
  };
  readonly ui: {
    setBundleVisible(bundle: string, visible: boolean): void;
  };
  readonly input: {
    captureKeys(...keys: string[]): () => void;
    captureText(): () => void;
    onPointerDown(callback: (event: SelenePointerEvent) => void): () => void;
    onPointerMove(callback: (event: SelenePointerEvent) => void): () => void;
    onPointerUp(callback: (event: SelenePointerEvent) => void): () => void;
  };
  readonly network: {
    sendToServer(payloadId: string, payload?: ClientNetworkPayload): void;
    onPayload(payloadId: string, callback: (payload: ClientNetworkPayload) => void): () => void;
    onConnected(callback: () => void): () => void;
  };
  readonly world: {
    getCameraCoordinate(): Coordinate;
    getCameraPosition(): Promise<{ x: number; y: number }>;
    setCameraPosition(position: { x: number; y: number }): Promise<Coordinate>;
    projectCoordinate(coordinate: Coordinate): { x: number; y: number };
    onCameraCoordinateChanged(callback: (coordinate: Coordinate) => void): () => void;
    onMapChanged(callback: (coordinate: Coordinate, width: number, height: number) => void): () => void;
  };
}

export interface VisualFrameDefinition {
  texture?: string;
  flipX?: boolean;
  flipY?: boolean;
}

export interface VisualDefinition extends VisualFrameDefinition {
  textures?: string[];
  frames?: Array<string | VisualFrameDefinition>;
  animations?: Record<
    string,
    VisualFrameDefinition & { textures?: string[]; frames?: Array<string | VisualFrameDefinition> }
  >;
  layers?: VisualDefinition[];
}

export const seleneKey: InjectionKey<SeleneUiApi> = Symbol('selene-api');

export const useSelene = (): SeleneUiApi => {
  const selene = inject(seleneKey);
  if (!selene) {
    throw new Error('Selene API was not provided.');
  }
  return selene;
};

export const createMockSeleneUiApi = (): SeleneUiApi => ({
  http: {
    request: async (path, payload = {}, method = 'GET') => {
      const url = new URL(path, window.location.href);
      if (method === 'GET') {
        for (const [key, value] of Object.entries(payload)) {
          if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
          }
        }
      }
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }),
      });
      if (!response.ok) {
        throw new Error(`HTTP operation failed: ${response.status}`);
      }
      return response.json();
    },
  },
  resolveAsset: async (path) => `/${path.replace(/^client\/ui\/dist\//, '')}`,
  visuals: {
    getDefinition: async (identifier) => {
      const response = await fetch('/client/registries/selene:visuals');
      const snapshot = (await response.json()) as { entries?: Record<string, VisualDefinition> };
      const definition = snapshot.entries?.[identifier];
      if (!definition) {
        throw new Error(`Visual not found: ${identifier}`);
      }
      return definition;
    },
  },
  ui: {
    setBundleVisible: () => undefined,
  },
  input: {
    captureKeys: () => () => undefined,
    captureText: () => () => undefined,
    onPointerDown: () => () => undefined,
    onPointerMove: () => () => undefined,
    onPointerUp: () => () => undefined,
  },
  network: {
    onConnected: (callback) => {
      callback();
      return () => undefined;
    },
    sendToServer: (payloadId, payload) => console.info('[Selene UI]', payloadId, payload),
    onPayload: () => () => undefined,
  },
  world: {
    getCameraCoordinate: () => ({ x: 0, y: 0, z: 0 }),
    getCameraPosition: async () => ({ x: 0, y: 0 }),
    setCameraPosition: async () => ({ x: 0, y: 0, z: 0 }),
    projectCoordinate: ({ x, y, z }) => ({ x: (x + y) * 38, y: -((x - y) * 19 + z * 114) }),
    onCameraCoordinateChanged: () => () => undefined,
    onMapChanged: () => () => undefined,
  },
});

export function editorHttpRequest(
  operation: string,
  payload: ClientNetworkPayload = {},
): {
  path: string;
  payload: ClientNetworkPayload;
  method: 'GET' | 'POST' | 'PUT';
} {
  const body = { ...payload };
  const segment = (key: string): string => {
    const value = body[key];
    delete body[key];
    if (typeof value !== 'string' || !value) {
      throw new Error(`Missing ${key}`);
    }
    return encodeURIComponent(value);
  };
  const filePath = (): string => {
    const value = body.path;
    delete body.path;
    if (typeof value !== 'string' || !value) {
      throw new Error('Missing path');
    }
    return value.split('/').map(encodeURIComponent).join('/');
  };
  let path: string;
  let method: 'GET' | 'POST' | 'PUT' = 'GET';
  switch (operation) {
    case 'request-bundles':
      path = '/resources/bundles';
      break;
    case 'request-bundle-registries':
      path = `/resources/bundles/${segment('bundle')}/registries`;
      break;
    case 'request-project':
      path = `/resources/bundles/${segment('bundle')}/registries/${segment('registry')}`;
      break;
    case 'search-registry':
      path = `/registries/${segment('registry')}/entries`;
      break;
    case 'search-scripts':
      path = '/scripts';
      break;
    case 'open-file':
      path = `/resources/files/${filePath()}`;
      break;
    case 'save-file':
      path = `/resources/files/${filePath()}`;
      method = 'PUT';
      break;
    case 'create-file':
      path = `/resources/bundles/${segment('bundle')}/registries/${segment('registry')}/files`;
      method = 'POST';
      break;
    case 'persist-changes':
    case 'discard-changes':
      path = `/resources/changes/${operation === 'persist-changes' ? 'persist' : 'discard'}`;
      if (body.path) {
        path += `/${filePath()}`;
      }
      method = 'POST';
      break;
    case 'pending-changes':
      path = '/resources/changes';
      break;
    default:
      throw new Error(`Unknown editor operation: ${operation}`);
  }
  return { path, payload: body, method };
}
