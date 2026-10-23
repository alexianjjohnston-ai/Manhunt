// URL of MapLibre's web worker (served as a hashed asset). The demo build swaps this
// module for web/src/demo/map-worker.ts, which builds a blob: URL instead.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

export default workerUrl;
