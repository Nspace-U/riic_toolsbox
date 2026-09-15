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
  const values = calculateSanityValues(DEFAULT_SANITY_SETTINGS);

  assert.ok(Math.abs(values.experience - 0.003) < 1e-12);
  assert.ok(Math.abs(values.pureGoldPoint - 0.0024) < 1e-12);
  assert.ok(Math.abs(values.drone - 0.05) < 1e-12);
  assert.ok(Math.abs(values.originiumShard - 6.5) < 1e-12);

  const netAmounts = {};
  addProductionFlow(
    netAmounts,
    {
      product: "LMD",
      amountPerHour: 100,
      materialPerHour: { "Pure Gold": -1 },
    },
    24,
  );
  assert.equal(netAmounts.LMD, 2400);
  assert.equal(netAmounts["Pure Gold"], -24);

  const result = calculateSanityResult(
    {
      LMD: 1000,
      Orundum: 100,
      "Pure Gold": 1,
      "Battle Record": 1,
      Drone: 60,
      Credit: 129,
      "Recruit Refresh": 1,
      "Originium Shard": -2,
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
