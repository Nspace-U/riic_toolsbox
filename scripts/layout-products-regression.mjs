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
  const expected = {
    243: ["赤金", "赤金", "中级作战记录", "中级作战记录"],
    "243-originium": ["赤金", "赤金", "中级作战记录", "源石碎片"],
    153: [
      "赤金",
      "中级作战记录",
      "中级作战记录",
      "中级作战记录",
      "中级作战记录",
    ],
    "full-252": [
      "赤金",
      "赤金",
      "中级作战记录",
      "中级作战记录",
      "中级作战记录",
    ],
    "right-full-252-32-trading": [
      "赤金",
      "赤金",
      "中级作战记录",
      "中级作战记录",
      "中级作战记录",
    ],
    "full-342": ["赤金", "赤金", "赤金", "赤金"],
    "right-full-342-331-trading": ["赤金", "赤金", "赤金", "赤金"],
    "right-full-342-originium": ["赤金", "赤金", "赤金", "源石碎片"],
    "right-full-342-322-trading": ["赤金", "赤金", "赤金", "赤金"],
  };
  assert.equal(LAYOUT_PRESETS.length, Object.keys(expected).length);
  for (const preset of LAYOUT_PRESETS) {
    const layout = parseLayoutText(preset.layoutText);
    if (preset.id === "right-full-342-originium") {
      assert.deepEqual(
        layout
          .filter((entry) => entry.type === "trading")
          .map((entry) => entry.level),
        [3, 1, 3],
      );
    }
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
      assert.deepEqual(
        plan.rooms.trading.map((room) => room.product),
        plan.rooms.trading.map((_, index, rooms) =>
          preset.originium && index === rooms.length - 1 ? "合成玉" : "龙门币",
        ),
      );
      assert.deepEqual(
        plan.rooms.manufacture.map((room) => room.product),
        expected[preset.id],
      );
      assert.ok(
        plan.rooms.manufacture.every(
          (room) =>
            (room.product === "源石碎片"
              ? room.sourceMaterial === "固源岩"
              : !room.sourceMaterial) && room.operators[0] === "阿米娅",
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
