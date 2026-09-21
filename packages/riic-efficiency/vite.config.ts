import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const PACKAGE_ROOT = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  build: {
    lib: {
      entry: `${PACKAGE_ROOT}src/index.ts`,
      formats: ["es"],
      fileName: "index",
    },
    emptyOutDir: false,
    outDir: `${PACKAGE_ROOT}dist`,
  },
});
