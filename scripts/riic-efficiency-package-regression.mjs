import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageModule = await import(
  pathToFileURL(
    path.join(root, "packages", "riic-efficiency", "dist", "index.js"),
  ).href
);
const operatorFile = JSON.parse(
  await readFile(
    path.join(
      root,
      "packages",
      "riic-efficiency",
      "data",
      "operators",
      "char_010_chen.json",
    ),
    "utf8",
  ),
);
const termsData = JSON.parse(
  await readFile(
    path.join(root, "packages", "riic-efficiency", "data", "terms.json"),
    "utf8",
  ),
);

assert.equal(operatorFile.terms, undefined);
assert.equal(operatorFile.termKeys, undefined);
assert.equal(termsData.terms["cc.g.lgd"].name, "龙门近卫局");
assert.ok(termsData.terms["cc.g.lgd"].members.includes("陈"));

const catalog = packageModule.createEfficiencyCatalog(
  [operatorFile],
  termsData.terms,
);
const ruleset = {
  ...packageModule.DEFAULT_RULESET,
  baseEfficiency: {
    ...packageModule.DEFAULT_RULESET.baseEfficiency,
    trading: 123,
  },
};
const result = packageModule.calculateEfficiency(
  {
    layout: [{ type: "trading", level: 3 }],
    plans: [
      {
        duration: 720,
        rooms: {
          trading: [{ product: "龙门币", operators: ["陈"] }],
        },
      },
    ],
    settings: {
      treatSkillsAsUnlocked: true,
      dormitoryDefaultIncludesMoodRecovery: false,
    },
  },
  { catalog, ruleset },
);

assert.equal(result.plans[0].facilities[0].baseEfficiency, 123);
assert.equal(result.plans[0].facilities[0].facility.type, "trading");

const materialResult = packageModule.calculateEfficiency(
  {
    layout: [{ type: "manufacture", level: 3 }],
    plans: [
      {
        duration: 720,
        rooms: {
          manufacture: [
            {
              product: "源石碎片",
              sourceMaterial: "固源岩",
              operators: ["陈"],
            },
          ],
        },
      },
    ],
  },
  {
    catalog,
    ruleset: {
      ...packageModule.DEFAULT_RULESET,
      baseEfficiency: {
        ...packageModule.DEFAULT_RULESET.baseEfficiency,
        manufacture: 150,
      },
    },
  },
);
const materialProduction = materialResult.plans[0].facilities[0].production;
assert.equal(materialProduction?.baseAmountPerHour, 1);
assert.ok(Math.abs((materialProduction?.amountPerHour ?? 0) - 1.51) < 1e-9);
assert.equal(materialProduction?.baseMaterialPerHour?.["固源岩"], -2);
assert.ok(
  Math.abs((materialProduction?.materialPerHour?.["固源岩"] ?? 0) + 3.02) <
    1e-9,
);

const droneRuleset = {
  ...packageModule.DEFAULT_RULESET,
  manufactureRules: {
    ...packageModule.DEFAULT_RULESET.manufactureRules,
    赤金: {
      ...packageModule.DEFAULT_RULESET.manufactureRules.赤金,
      amount: 2,
      hours: 1,
    },
  },
};
const droneResult = packageModule.calculateDroneAcceleration(
  {
    layout: [{ type: "manufacture", level: 3 }],
    plans: [
      {
        duration: 720,
        rooms: {
          manufacture: [{ product: "赤金", operators: [] }],
        },
      },
    ],
  },
  catalog,
  { 无人机: 1 },
  { ruleset: droneRuleset },
);

assert.equal(droneResult.scenarios[0].product, "赤金");
assert.equal(droneResult.scenarios[0].baseAmountPerHour, 2);
console.log("riic efficiency package regression: passed");
