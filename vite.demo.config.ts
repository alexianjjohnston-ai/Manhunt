import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** The engine's crypto helpers use node:crypto; swap in the browser version for the demo. */
function browserSecurity(): Plugin {
  return {
    name: 'demo-browser-security',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './security' && importer?.includes('/server/')) return r('./web/src/demo/security.ts');
      return null;
    },
  };
}

// Single self-contained HTML file (all JS, CSS, fonts and the map worker inlined),
// for hosting as a static page with no backend.
export default defineConfig({
  root: 'web',
  publicDir: false,
  plugins: [browserSecurity(), react(), tailwindcss(), viteSingleFile()],
  define: { __DEMO__: 'true' },
  resolve: {
    alias: [
      { find: /^@\/map-worker$/, replacement: r('./web/src/demo/map-worker.ts') },
      { find: '@shared', replacement: r('./shared') },
      { find: '@', replacement: r('./web/src') },
    ],
  },
  build: {
    outDir: '../dist/demo',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
    rollupOptions: { input: r('./web/demo.html') },
  },
});
