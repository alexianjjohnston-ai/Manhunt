/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** App version from package.json, injected at build time. */
  readonly VITE_APP_VERSION: string;
}
