import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});

try {
  const [
    { buildRecycleRules, getRiicEfficiencyCatalog },
    { calculateEfficiency },
  ] = await Promise.all([
    vite.ssrLoadModule("/src/adapters/riicEfficiencyData.ts"),
    vite.ssrLoadModule("/packages/riic-efficiency/src/index.ts"),
  ]);
  const [buildingData, itemTable] = await Promise.all(
    ["building_data", "item_table"].map(async (name) =>
      JSON.parse(
        await readFile(
          `public/assets/gamedata/latest/excel/${name}.json`,
          "utf8",
        ),
      ),
    ),
  );
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-11-04T00:00:00Z");
  let rules;
  try {
    rules = buildRecycleRules(buildingData, itemTable);
  } finally {
    Date.now = originalNow;
  }
  assert.ok(rules, "实际游戏数据应能生成回收站规则");
  assert.deepEqual(
    rules.phases.map((phase) => phase.maxStationedNum),
    [1, 2, 2],
  );
  const catalog = getRiicEfficiencyCatalog(rules);
  for (const [index, baseEfficiency] of [100, 100, 120].entries()) {
    const result = calculateEfficiency(
      {
        layout: [{ type: "recycle", level: index + 1 }],
        plans: [{ duration: 1440, rooms: { recycle: [{ operators: [] }] } }],
      },
      { catalog, ruleset: catalog.ruleset },
    );
    const facility = result.plans[0].facilities[0];
    assert.equal(facility.baseEfficiency, baseEfficiency);
    assert.ok(
      Math.abs(facility.production.amountPerDay - baseEfficiency / 200) < 1e-9,
    );
    assert.ok(result.recycleOutputs.length > 0);
  }
  console.log("回收站真实数据与产出检查通过");
} finally {
  await vite.close();
}
