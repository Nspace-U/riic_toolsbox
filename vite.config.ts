import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@arknights/riic-efficiency": fileURLToPath(
        new URL("./packages/riic-efficiency/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    // chokidar v5 只接受函数、正则或精确路径，glob 字符串不会被展开
    watch: {
      ignored: [
        (path: string) =>
          path.split(/[\\/]/).some((segment) => segment.endsWith("-tmpdir")),
      ],
    },
  },
});
