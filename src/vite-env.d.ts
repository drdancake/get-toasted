/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Commit the build came from. Set by the Pages workflow; "dev" locally. */
  readonly VITE_BUILD_ID?: string;
}
