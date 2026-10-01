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

const timedDocument = {
  layout: [{ type: "trading", level: 3 }],
  plans: [
    {
      period: [["00:00", "05:59"]],
      duration: 1,
      rooms: { trading: [{ product: "龙门币", operators: [] }] },
    },
    {
      period: [["06:00", "11:59"]],
      duration: 1,
      rooms: { trading: [{ product: "龙门币", operators: [] }] },
    },
    {
      period: [["12:00", "23:59"]],
      duration: 1,
      rooms: { trading: [{ product: "龙门币", operators: [] }] },
    },
  ],
};
const timedAnalysis = packageModule.analyzeSchedulePeriods(timedDocument);
assert.deepEqual(timedAnalysis.durations, [360, 360, 720]);
assert.deepEqual(timedAnalysis.errors, []);
assert.deepEqual(timedAnalysis.warnings, []);

const gapAnalysis = packageModule.analyzeSchedulePeriods({
  ...timedDocument,
  plans: [timedDocument.plans[0], timedDocument.plans[2]],
});
assert.equal(gapAnalysis.errors.length, 0);
assert.ok(gapAnalysis.warnings.length > 0);

const overlapDocument = {
  ...timedDocument,
  plans: [
    timedDocument.plans[0],
    {
      ...timedDocument.plans[1],
      period: [["05:00", "11:59"]],
    },
  ],
};
const overlapAnalysis = packageModule.analyzeSchedulePeriods(overlapDocument);
assert.ok(overlapAnalysis.errors.length > 0);
assert.throws(() =>
  packageModule.calculateEfficiency(overlapDocument, { catalog }),
);

const oneMinuteAnalysis = packageModule.analyzeSchedulePeriods({
  ...timedDocument,
  plans: [
    {
      ...timedDocument.plans[0],
      period: [["06:00", "06:00"]],
    },
  ],
});
assert.deepEqual(oneMinuteAnalysis.durations, [1]);

const noticeDocument = {
  layout: [{ type: "trading", level: 1 }],
  plans: [{ rooms: {} }],
};
const noticeResult = {
  maaDroneAcceleration: {
    warnings: [
      { code: "overflow", message: "无人机库存将超过上限" },
      {
        code: "noProduction",
        message: "队列1：无人机目标设施没有有效产出，未参与无人机计算",
      },
    ],
  },
  warnings: ["缺少陈的技能数据"],
  plans: [
    {
      moodWarnings: [
        {
          facility: "trading",
          facilityIndex: 0,
          operator: "陈",
          previousEnd: 12.345,
          configuredStart: 13.25,
        },
      ],
      moods: [
        {
          facility: "trading",
          facilityId: "trading-0",
          facilityIndex: 0,
          operator: "陈",
          working: true,
          start: 3,
          end: 0,
        },
      ],
      autoRestWarnings: [
        { operator: "阿米娅", reason: "no-space", startMood: 2 },
        {
          operator: "能天使",
          reason: "not-recovered",
          startMood: 17,
          endMood: 19,
          expectedMood: 20,
          facilityIndex: 0,
        },
      ],
      facilities: [
        {
          facility: { id: "trading-0", type: "trading", index: 0 },
          production: { overflowed: true, breachTime: 0.5 },
        },
      ],
    },
  ],
  fiammetta: { mode: "direct" },
  fiammettaWarnings: ["菲亚梅塔无法完全恢复"],
};
assert.deepEqual(
  packageModule.buildEfficiencyNotices({
    document: noticeDocument,
    result: noticeResult,
  }),
  [
    {
      code: "negative-power",
      level: "warning",
      message: "电力不足",
      details: ["当前布局提供 0 点电力，消耗 10 点电力，净电力 -10 点"],
    },
    {
      code: "maa-drone-overflow",
      level: "info",
      message: "发现无人机爆仓风险",
      details: ["无人机库存将超过上限"],
    },
    {
      code: "maa-drone-target",
      level: "warning",
      message: "无人机加速目标无效",
      details: ["队列1：无人机目标设施没有有效产出，未参与无人机计算"],
    },
    {
      code: "missing-skill-data",
      level: "error",
      message: "找不到干员技能数据",
      details: ["缺少陈的技能数据"],
    },
    {
      code: "mood-inheritance",
      level: "warning",
      message: "发现心情继承异常",
      details: [
        "队列1 · 贸易站 1 · 陈：上一队列结束心情 12.35，当前手动设置为 13.25",
      ],
    },
    {
      code: "mood-work-zero",
      level: "warning",
      message: "有干员在工作后心情降至 0",
      details: ["队列1 · 贸易站 1 · 陈：工作后心情从 3 降至 0"],
    },
    {
      code: "mood-auto-rest-no-space",
      level: "info",
      message: "宿舍槽位不足，无法自动休整",
      details: ["队列1 · 阿米娅：休整前心情 2"],
    },
    {
      code: "mood-auto-rest-not-recovered",
      level: "info",
      message: "自动休整后心情未达到预期",
      details: [
        "队列1 · 能天使 · 宿舍 1：休整后心情 19，低于下次工作预期 20（休整前 17）",
      ],
    },
    {
      code: "fiammetta-mood",
      level: "warning",
      message: "菲亚梅塔无法完全恢复这些干员心情",
      details: [],
    },
    {
      code: "overflow-risk",
      level: "info",
      message: "发现爆仓风险",
      details: ["队列1 · 贸易站 · 陈：将在工作 0.5 小时后爆仓"],
    },
  ],
);
const queueWarningResult = {
  ...noticeResult,
  fiammetta: { mode: "queue" },
  fiammettaWarnings: ["队列模式下无法恢复"],
  plans: noticeResult.plans.map((plan) => ({
    ...plan,
    facilities: plan.facilities.map((facility) => ({
      ...facility,
      production: { ...facility.production, breachTime: 0 },
    })),
  })),
};
assert.deepEqual(
  packageModule
    .buildEfficiencyNotices({
      document: noticeDocument,
      result: queueWarningResult,
    })
    .slice(-2),
  [
    {
      code: "fiammetta-mood",
      level: "warning",
      message: "发现菲亚梅塔心情恢复异常",
      details: ["队列模式下无法恢复"],
    },
    {
      code: "overflow-risk",
      level: "info",
      message: "发现爆仓风险",
      details: ["队列1 · 贸易站 · 陈：将立即爆仓"],
    },
  ],
);

const gapDocument = {
  layout: [{ type: "trading", level: 1 }],
  plans: [{ period: [["06:00", "11:59"]], rooms: {} }],
};
assert.deepEqual(
  packageModule.buildEfficiencyNotices({ document: gapDocument }),
  [
    {
      code: "negative-power",
      level: "warning",
      message: "电力不足",
      details: ["当前布局提供 0 点电力，消耗 10 点电力，净电力 -10 点"],
    },
    {
      code: "schedule-period-gap",
      level: "info",
      message: "定时换班存在时间空档",
      details: packageModule.analyzeSchedulePeriods(gapDocument).warnings,
    },
  ],
);
assert.deepEqual(
  packageModule
    .buildEfficiencyNotices({
      document: noticeDocument,
      efficiencyError: "无法读取效率数据",
      result: noticeResult,
    })
    .map(({ code }) => code),
  ["negative-power", "efficiency-data-error"],
);
const invalidPeriodDocument = {
  layout: [{ type: "trading", level: 1 }],
  plans: [{ period: [["25:00", "26:00"]], rooms: {} }],
};
assert.deepEqual(
  packageModule
    .buildEfficiencyNotices({
      document: invalidPeriodDocument,
      result: noticeResult,
    })
    .map(({ code }) => code),
  ["negative-power", "schedule-period-error"],
);

assert.deepEqual(
  packageModule.buildImportedExtraRoomsNotice({
    layout: [{ type: "trading", level: 1 }],
    plans: [
      {
        rooms: {
          trading: [{}, { operators: ["陈", "阿米娅"] }],
        },
      },
    ],
  }),
  {
    code: "import-extra-rooms",
    level: "error",
    message: "导入排班表包含未登记设施实例",
    details: ["队列1 · 贸易站 2：陈、阿米娅"],
    closable: true,
  },
);
assert.equal(
  packageModule.buildImportedExtraRoomsNotice(noticeDocument),
  undefined,
);
console.log("riic efficiency package regression: passed");
