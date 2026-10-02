import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const logPath = `${projectRoot}.dev-server.log`;
const port = Number(process.env.DEV_SERVER_PORT ?? 5173);

function log(message) {
  appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

process.on("uncaughtException", (error) => {
  log(`uncaughtException: ${error?.stack ?? error}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log(`unhandledRejection: ${reason?.stack ?? reason}`);
  process.exit(1);
});

const server = await createServer({
  root: projectRoot,
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  cacheDir: fileURLToPath(
    new URL("../node_modules/.vite-dev", import.meta.url),
  ),
  clearScreen: false,
  server: { port, strictPort: true },
});

await server.listen();
writeFileSync(`${projectRoot}.dev-server.pid`, String(process.pid), "utf8");

log(
  `listening pid=${process.pid} port=${port} cacheDir=node_modules/.vite-dev`,
);
log("ready");
