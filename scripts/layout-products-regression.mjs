import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});

try {
  const { LAYOUT_PRESETS, applyPresetProducts, setRoomProduct } =
    await vite.ssrLoadModule("/src/utils/simulator/layout.ts");
  const { parseLayoutText } = await vite.ssrLoadModule(
    "/src/utils/schedule.ts",
  );
  const expected = [2, 1, 2, 2, 4, 4, 4];
  for (const [index, preset] of LAYOUT_PRESETS.entries()) {
    const layout = parseLayoutText(preset.layoutText);
    const createRooms = (type) =>
      layout
        .filter((entry) => entry.type === type)
        .map(() => ({
          product: "源石碎片",
          sourceMaterial: "装置",
          operators: ["阿米娅"],
        }));
    const plans = Array.from({ length: 2 }, () => ({
      rooms: {
        trading: createRooms("trading"),
        manufacture: createRooms("manufacture"),
      },
    }));
    applyPresetProducts(plans, preset);
    for (const plan of plans) {
      assert.ok(plan.rooms.trading.every((room) => room.product === "龙门币"));
      assert.deepEqual(
        plan.rooms.manufacture.map((room) => room.product),
        plan.rooms.manufacture.map((_, position) =>
          position < expected[index] ? "赤金" : "中级作战记录",
        ),
      );
      assert.ok(
        plan.rooms.manufacture.every(
          (room) => !room.sourceMaterial && room.operators[0] === "阿米娅",
        ),
      );
    }
  }
  const room = {};
  setRoomProduct(room, "源石碎片", true);
  assert.deepEqual(room, { product: "源石碎片", sourceMaterial: "固源岩" });
  room.sourceMaterial = "装置";
  setRoomProduct(room, "源石碎片", true);
  assert.equal(room.sourceMaterial, "装置");
  setRoomProduct(room, "", true);
  assert.deepEqual(room, { productOverride: true });
  setRoomProduct(room, "__inherit__", true);
  assert.deepEqual(room, {});
  console.log("PASS 预设产物、材料和继承状态");
} finally {
  await vite.close();
}
