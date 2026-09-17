import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});

try {
  const { operatorPasteAssignments } = await vite.ssrLoadModule(
    "/src/utils/simulator/operatorClipboard.ts",
  );
  const source = { name: "能天使" };
  const targets = ["0", "1", "2"];
  const fallback = [{ address: "0", entry: source }];

  assert.deepEqual(
    operatorPasteAssignments([source], targets, fallback),
    targets.map((address) => ({ address, entry: source })),
  );
  assert.deepEqual(
    operatorPasteAssignments([""], targets, fallback),
    targets.map((address) => ({ address, entry: "" })),
  );
  assert.deepEqual(
    operatorPasteAssignments([source], ["0"], fallback),
    fallback,
  );
  assert.deepEqual(
    operatorPasteAssignments([source, { name: "机械师" }], targets, fallback),
    fallback,
  );
  console.log("simulator clipboard regression: passed");
} finally {
  await vite.close();
}
