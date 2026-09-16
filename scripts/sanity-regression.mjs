import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});

try {
  const {
    addProductionFlow,
    calculateSanityResult,
    calculateSanityValues,
    DEFAULT_SANITY_SETTINGS,
  } = await vite.ssrLoadModule("/src/utils/sanity.ts");
  const { manufactureRule } = await vite.ssrLoadModule(
    "/src/utils/efficiency/baseRules.ts",
  );
  assert.equal(manufactureRule("中级作战记录")?.recipe, "作战记录");
  assert.equal(manufactureRule("赤金")?.recipe, "贵金属");
  assert.equal(manufactureRule("源石碎片", "固源岩")?.recipe, "源石碎片");
  const values = calculateSanityValues(DEFAULT_SANITY_SETTINGS);

  assert.ok(Math.abs(values.experience - 0.003) < 1e-12);
  assert.ok(Math.abs(values.pureGoldPoint - 0.0024) < 1e-12);
  assert.ok(Math.abs(values.drone - 0.05) < 1e-12);
  assert.ok(Math.abs(values.originiumShard - 6.5) < 1e-12);

  const netAmounts = {};
  addProductionFlow(
    netAmounts,
    {
      product: "龙门币",
      amountPerHour: 100,
      materialPerHour: { 赤金: -1 },
    },
    24,
  );
  assert.equal(netAmounts.龙门币, 2400);
  assert.equal(netAmounts.赤金, -24);

  const recipeAliasAmounts = {};
  addProductionFlow(
    recipeAliasAmounts,
    {
      product: "龙门币",
      amountPerHour: 100,
      materialPerHour: { 贵金属: -1 },
    },
    24,
  );
  assert.equal(recipeAliasAmounts.赤金, -24);

  const result = calculateSanityResult(
    {
      龙门币: 1000,
      合成玉: 100,
      赤金: 1,
      中级作战记录: 1,
      无人机: 60,
      信用: 129,
      公开招募标签刷新次数: 1,
      源石碎片: -2,
    },
    values,
  );

  assert.equal(result.complete, true);
  assert.equal(result.items.length, 8);
  assert.ok(Math.abs(result.total - 97.2058820209763) < 1e-9);

  const incomplete = calculateSanityResult({ 固源岩: -1 }, values);
  assert.deepEqual(incomplete.missing, ["固源岩"]);
  assert.equal(incomplete.complete, false);
  console.log("理智计算回归通过");
} finally {
  await vite.close();
}
