// Demo (single-file) build: the worker source is inlined and started from a blob: URL.
import source from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw';

export default URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
