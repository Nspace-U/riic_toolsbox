import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const goldenPath = path.join(
  root,
  "scripts",
  "fixtures",
  "result-display-golden.json",
);
const packageModule = await import(
  pathToFileURL(
    path.join(root, "packages", "riic-efficiency", "dist", "index.js"),
  ).href
);

const tradeGapDetail = {
  operator: "孑",
  skill: "摊贩经济",
  stat: "tradeGapEff",
  value: 40,
  facility: "trading",
  calculation: {
    type: "tradeGap",
    mode: "max",
    durationHours: 12,
    gapBase: 10,
    gapValue: 40,
    initialEfficiency: 137,
    averageEfficiency: 137,
    firstItemProgress: 0,
    completedOrders: 0,
    decrement: 0,
    orderIncrement: 0,
    fallbackReason: "missingOrders",
  },
};
const curveDetail = {
  operator: "能天使",
  skill: "物流专家",
  stat: "tradeSpd",
  value: 35,
  facility: "trading",
  calculation: {
    type: "curve",
    beforeHours: 0,
    durationHours: 12,
    startValue: 20,
    startHours: 0,
    step: 5,
    cap: 40,
    steps: [
      { hour: 0, weight: 1, value: 20 },
      { hour: 1, weight: 1, value: 25 },
    ],
    workHours: { threshold: 2, activeHours: 10 },
  },
};
const statDetail = {
  operator: "正义骑士号",
  skill: "骑士精神",
  stat: "tradeNetEff",
  value: 5,
  facility: "trading",
  calculation: {
    type: "stat",
    durationHours: 12,
    steps: [{ startHours: 0, endHours: 12, value: 5 }],
  },
};
const workHoursDetail = {
  operator: "德克萨斯",
  skill: "默契",
  stat: "tradeSpd",
  value: 10,
  facility: "trading",
  calculation: {
    type: "workHours",
    beforeHours: 4,
    durationHours: 12,
    threshold: 6,
    activeHours: 10,
    baseValue: 12,
  },
};

function tradingFacility() {
  return {
    facility: { id: "trading-0", type: "trading", level: 3, index: 0 },
    baseEfficiency: 100,
    moodEfficiency: 2,
    operatorEfficiency: 35,
    skillEfficiency: 35,
    operatorSkillEfficiency: 35,
    efficiency: 137,
    attributes: { orderLimit: { base: 10, skill: 1, total: 11 } },
    cluePreferences: [1, "owned"],
    capacity: {
      label: "订单上限",
      unit: "单",
      base: 10,
      skill: 1,
      total: 11,
      segments: [
        { startHours: 0, endHours: 6, base: 10, skill: 0, total: 10 },
        { startHours: 6, endHours: 12, base: 10, skill: 1, total: 11 },
      ],
    },
    production: {
      product: "龙门币",
      cluePreferences: [2, "unowned"],
      conversion: {
        label: "信用",
        amountPerUnit: 40,
        sourceUnit: "线索",
        baseCycleHours: 20,
      },
      baseAmountPerHour: 427.73,
      amountPerHour: 585.99,
      amountPerDay: 14063.76,
      itemRate: 0.4,
      breachTime: 24.74,
      overflowed: false,
      orderRule: "龙门商法",
      orders: [
        {
          name: "2贵金属订单",
          probability: 0.3,
          quantity: 1000,
          time: 2.4,
          material: "赤金",
          amount: 2,
        },
        {
          name: "4贵金属订单",
          probability: 0.2,
          quantity: 2000,
          time: 4.6,
          ignoreEfficiency: true,
        },
      ],
      baseMaterialPerHour: { 赤金: -0.86 },
      materialPerHour: { 赤金: -1.17 },
      effectiveMaterialPerHour: { 赤金: -1.17 },
    },
    details: [tradeGapDetail, curveDetail, statDetail, workHoursDetail],
    baseDetails: [],
    combinationDetails: [],
  };
}

function inheritedFacility() {
  return {
    facility: { id: "manufacture-0", type: "manufacture", level: 3, index: 0 },
    inherited: true,
    inheritedFromPlanIndex: 1,
    baseEfficiency: 100,
    moodEfficiency: 1,
    operatorEfficiency: 0,
    skillEfficiency: 0,
    operatorSkillEfficiency: 0,
    efficiency: 101,
    attributes: {},
    capacity: {
      label: "仓库容量",
      unit: "格",
      base: 54,
      skill: 0,
      total: 54,
      segments: [
        { startHours: 0, endHours: 12, base: 54, skill: 0, total: 54 },
      ],
    },
    production: {
      product: "赤金",
      baseAmountPerHour: 0.83,
      amountPerHour: 0.84,
      amountPerDay: 20.16,
      itemRate: 0.84,
      breachTime: 32.08,
      overflowed: false,
      baseMaterialPerHour: { 固源岩: -2 },
      materialPerHour: { 固源岩: -3.02 },
      effectiveMaterialPerHour: { 固源岩: -3.02 },
    },
    details: [],
    baseDetails: [],
    combinationDetails: [],
  };
}

const droneDetail = {
  planIndex: 0,
  facilityId: "trading-0",
  room: "trading",
  facilityIndex: 0,
  order: "pre",
  sourcePlanIndex: 1,
  sourceDurationHours: 12,
  product: "龙门币",
  droneAmount: 240,
  acceleratedHours: 12,
  baseAmountPerHour: 427.73,
  baseMaterialPerHour: {},
  extraAmount: 5132.76,
  extraMaterial: { 赤金: -14.06 },
  overflowed: true,
  overflowAmount: 5,
};
const droneCandidate = {
  ...droneDetail,
  facilityId: "manufacture-0",
  room: "manufacture",
  product: "赤金",
  baseAmountPerHour: 0.83,
  extraAmount: 9.96,
  extraMaterial: { 固源岩: -3.02 },
  accelerated: false,
  overflowed: false,
  overflowAmount: 0,
};

const moods = [
  {
    operator: "能天使",
    facility: "trading",
    facilityId: "trading-0",
    facilityIndex: 0,
    slotIndex: 0,
    start: 24,
    end: 17.4,
    costRate: 0.55,
    working: true,
    rateDetails: [
      { kind: "base", value: 1 },
      { kind: "controlWorkers", value: -0.1, count: 2 },
      { kind: "facilityWorkers", value: -0.05, count: 2 },
      {
        kind: "skill",
        value: -0.3,
        operator: "能天使",
        skill: "物流专家",
        stat: "moodCost",
      },
    ],
  },
  {
    operator: "令",
    facility: "control",
    facilityId: "control-0",
    facilityIndex: 0,
    slotIndex: 0,
    start: 24,
    end: 13.2,
    costRate: 0.9,
    working: true,
    rateDetails: [
      { kind: "base", value: 1 },
      { kind: "controlWorkers", value: -0.1, count: 2 },
    ],
  },
];

const result = {
  document: {
    layout: [
      { type: "control", level: 5 },
      { type: "trading", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "power", level: 3 },
    ],
    plans: [{ name: "早班" }, { name: "晚班" }],
  },
  plans: [
    {
      name: "早班",
      durationHours: 12,
      facilities: [tradingFacility(), inheritedFacility()],
      moods,
      moodWarnings: [],
      autoRestWarnings: [],
      fiammettaWarnings: [],
      basePoints: { term_pure_gold: 15 },
      basePointDetails: [
        {
          term: "term_pure_gold",
          value: 15,
          sources: [
            {
              kind: "gain",
              operator: "令",
              skill: "山河远阔",
              facility: "control",
              facilityIndex: 0,
              slotIndex: 0,
              value: 15,
            },
            {
              kind: "convert",
              operator: "鸿雪",
              facility: "trading",
              facilityIndex: 0,
              slotIndex: 1,
              value: 5,
              from: "term_pure_gold",
              rate: 0.5,
            },
          ],
        },
      ],
      warnings: [],
      droneAccelerations: [droneDetail],
    },
    {
      name: "晚班",
      durationHours: 12,
      facilities: [],
      moods: [],
      moodWarnings: [],
      autoRestWarnings: [],
      fiammettaWarnings: [],
      basePoints: {},
      basePointDetails: [],
      warnings: [],
      droneAccelerations: [],
    },
  ],
  dailyHours: 24,
  dailyFacilities: [],
  dailyProductions: [
    {
      product: "赤金",
      baseAmountPerHour: 0.83,
      amountPerHour: 1.13,
      effectiveAmountPerHour: 1.13,
      amountPerDay: 27.12,
      effectiveAmountPerDay: 27.12,
      baseMaterialPerHour: { 固源岩: -2 },
      materialPerHour: { 固源岩: -3.02 },
      effectiveMaterialPerHour: { 固源岩: -3.02 },
    },
    {
      product: "无人机",
      baseAmountPerHour: 10,
      amountPerHour: 10,
      effectiveAmountPerHour: 10,
      amountPerDay: 240,
      effectiveAmountPerDay: 240,
    },
  ],
  dailyOutputs: [
    { product: "龙门币", kind: "production", amountPerDay: 14823.01 },
    { product: "赤金", kind: "production", amountPerDay: 27.12 },
    { product: "无人机", kind: "production", amountPerDay: 240 },
    { product: "中级作战记录", kind: "net", amountPerDay: 1234.56 },
    { product: "信用", kind: "net", amountPerDay: 759.1 },
  ],
  fiammettaWarnings: [],
  warnings: [],
  maaDroneAcceleration: {
    enabled: true,
    details: [droneDetail],
    candidates: [droneDetail, droneCandidate],
    warnings: [],
    generatedDrones: 300,
    usedDrones: 240,
  },
};

const sanityValues = packageModule.calculateSanityValues(
  packageModule.DEFAULT_SANITY_SETTINGS,
);
const displayOptions = {
  sanityValues,
  droneAcceleration: {
    dailyDrones: 300,
    acceleratedHours: 15,
    scenarios: [
      {
        key: "龙门币",
        product: "龙门币",
        sourceLabel: "早班 · 贸易站1",
        baseAmountPerHour: 427.73,
        baseMaterialPerHour: { 赤金: -0.86 },
        droneAmount: 300,
        acceleratedHours: 15,
        extraFlow: { 龙门币: 6415.95, 赤金: -17.58 },
      },
    ],
  },
  facilityLabel: (facility) =>
    packageModule.formatFacilityResultLabel(facility, result.document.layout),
  basePointLabel: (term) => (term === "term_pure_gold" ? "人间烟火" : term),
  basePointSource: (source) =>
    source.kind === "convert"
      ? `${source.operator}（${source.facility}，由人间烟火 × ${source.rate}派生）`
      : `${source.operator} · ${source.skill}（${source.facility}）`,
  visibleBasePointTerms: new Set(["term_pure_gold"]),
  sourceFacilityForProduct: (product) =>
    packageModule.resultPresentationSourceFacility(product, result),
};
const display = packageModule.buildResultDisplay(result, displayOptions);
const modeDailyAmounts = Object.fromEntries(
  result.dailyOutputs.map((output) => [output.product, output.amountPerDay]),
);
modeDailyAmounts.赤金 = 44.2;
const modeDroneAcceleration = {
  ...displayOptions.droneAcceleration,
  scenarios: [
    ...displayOptions.droneAcceleration.scenarios,
    {
      key: "赤金",
      product: "赤金",
      sourceLabel: "早班 · 制造站2",
      baseAmountPerHour: 0.83,
      baseMaterialPerHour: {},
      droneAmount: 300,
      acceleratedHours: 15,
      extraFlow: { 赤金: 12.45 },
    },
  ],
};
const displaysByMode = new Map(
  ["raw", "points", "both"].map((mode) => [
    mode,
    packageModule.buildResultDisplay(result, {
      ...displayOptions,
      dailyAmounts: modeDailyAmounts,
      droneAcceleration: modeDroneAcceleration,
      resourceAmountDisplayMode: mode,
    }),
  ]),
);

function displayText(value) {
  return packageModule.formatDisplayValue(value);
}

function displayForMode(mode) {
  const modeDisplay = displaysByMode.get(mode);
  assert.ok(modeDisplay, `missing display mode: ${mode}`);
  return modeDisplay;
}

for (const mode of ["raw", "points", "both"]) {
  const modeDisplay = displayForMode(mode);
  const dailyGold = modeDisplay.dailyOutput.tiles.find(
    (tile) => tile.product === "赤金",
  );
  const dailyBattleRecords = modeDisplay.dailyOutput.tiles.find(
    (tile) => tile.product === "中级作战记录",
  );
  const goldGrossPoints = dailyGold.lines.find(
    (line) => line.key === "gross-points",
  );
  const goldNetLines = dailyGold.lines.filter((line) =>
    ["net", "net-points"].includes(line.key),
  );
  assert.ok(dailyGold);
  assert.ok(dailyBattleRecords);
  if (mode === "raw") {
    assert.equal(displayText(dailyGold.main), "27.12");
    assert.equal(dailyGold.mainUnit, "赤金");
    assert.equal(goldGrossPoints, undefined);
    assert.deepEqual(
      goldNetLines.map((line) => displayText(line.value)),
      ["净收入 +44.2 赤金"],
    );
  } else if (mode === "points") {
    assert.equal(displayText(dailyGold.main), "13560");
    assert.equal(dailyGold.mainUnit, "赤金点数");
    assert.equal(goldGrossPoints, undefined);
    assert.deepEqual(
      goldNetLines.map((line) => displayText(line.value)),
      ["净收入 +22100 赤金点数"],
    );
  } else {
    assert.equal(displayText(dailyGold.main), "27.12");
    assert.equal(dailyGold.mainUnit, "赤金");
    assert.equal(displayText(goldGrossPoints.value), "13560 赤金点数");
    assert.deepEqual(
      goldNetLines.map((line) => displayText(line.value)),
      ["净收入 +44.2 赤金", "+22100 赤金点数"],
    );
  }
  assert.equal(
    displayText(dailyBattleRecords.main),
    mode === "points" ? "+1234560" : "+1234.56",
  );
  assert.equal(
    dailyBattleRecords.mainUnit,
    mode === "points" ? "经验点数" : "中级作战记录",
  );

  const tradingStep = modeDisplay.calculationSteps.facilitySteps.steps.find(
    (step) => step.facilityId === "trading-0",
  );
  const productionSection = tradingStep.sections.find(
    (section) => section.key === "production-capacity",
  );
  const goldMaterialRate = productionSection.rows.find(
    (row) => row.key === "facility-material-赤金-0-rate",
  );
  const orderSummary = productionSection.sections.find(
    (section) => section.key === "production-orders",
  );
  const goldOrder = orderSummary.rows.find((row) =>
    displayText(row.label).includes("2贵金属订单"),
  );
  const dailyOutputCard = modeDisplay.calculationSteps.dailyOutput.cards[0];
  const dailyGoldSection = dailyOutputCard.sections.find(
    (section) => section.key === "product-赤金",
  );
  const dailyGoldRate = dailyGoldSection.rows.find(
    (row) => row.key === "赤金-base-output",
  );
  const dailyLmdSection = dailyOutputCard.sections.find(
    (section) => section.key === "product-龙门币",
  );
  const queueGoldMaterial = dailyLmdSection.sections
    .find((section) => section.key === "龙门币-materials")
    .rows.find((row) => row.key === "龙门币-material-赤金-base");
  if (mode === "raw") {
    assert.equal(displayText(goldMaterialRate.value), "赤金 -1.17/小时");
    assert.ok(displayText(goldOrder.value).includes("赤金 × 2"));
    assert.ok(displayText(dailyGoldRate.value).includes(" 赤金/小时"));
    assert.ok(displayText(queueGoldMaterial.value).startsWith("赤金 -"));
  } else if (mode === "points") {
    assert.equal(displayText(goldMaterialRate.value), "赤金点数 -585/小时");
    assert.ok(displayText(goldOrder.value).includes("赤金点数 × 1000"));
    assert.ok(displayText(dailyGoldRate.value).includes(" 赤金点数/小时"));
    assert.ok(displayText(queueGoldMaterial.value).startsWith("赤金点数 -"));
  } else {
    assert.equal(
      displayText(goldMaterialRate.value),
      "赤金 -1.17/小时（赤金点数 -585/小时）",
    );
    assert.ok(
      displayText(goldOrder.value).includes("赤金 × 2（1000 赤金点数）"),
    );
    assert.ok(displayText(dailyGoldRate.value).includes(" 赤金/小时（"));
    assert.ok(displayText(dailyGoldRate.value).includes(" 赤金点数/小时）"));
    assert.ok(displayText(queueGoldMaterial.value).includes("赤金点数 -"));
  }

  const maaDetails =
    modeDisplay.calculationSteps.maaDrone.cards[0].sections.find(
      (section) => section.key === "maa-0-details",
    );
  const maaGoldMaterial = maaDetails.rows.find(
    (row) => row.key === "drone-trading-0-pre-material-赤金",
  );
  assert.equal(
    displayText(maaGoldMaterial.value),
    mode === "raw"
      ? "赤金 -14.06"
      : mode === "points"
        ? "赤金点数 -7030"
        : "赤金 -14.06（赤金点数 -7030）",
  );

  const redGoldScenario = modeDisplay.droneScenarios.find(
    (scenario) => scenario.key === "赤金",
  );
  assert.deepEqual(
    redGoldScenario.baseRateLines.map(displayText),
    mode === "raw"
      ? ["基础 0.83 赤金/小时"]
      : mode === "points"
        ? ["基础 415 赤金点数/小时"]
        : ["基础 0.83 赤金/小时", "折算 415 赤金点数/小时"],
  );

  for (const scenario of modeDisplay.droneScenarios) {
    for (const view of scenario.views) {
      for (const tile of view.tiles) {
        assert.equal(
          tile.lines.some((line) => line.key === "net-resource"),
          false,
        );
      }
    }
  }
}

function flatten(entries) {
  const lines = [];
  const value = (item) =>
    item === undefined ? "" : packageModule.formatDisplayValue(item);
  const raws = (item) =>
    item?.raws === undefined
      ? ""
      : `${item.template}#${item.raws
          .map((raw) => `${raw.value}${raw.signed === true ? "s" : ""}`)
          .join(",")}`;

  lines.push(`cycle:${value(entries.dailyOutput.cycleHours)}`);
  for (const tile of entries.dailyOutput.tiles) {
    lines.push(`tile:${tile.product}:${value(tile.main)}|${raws(tile.main)}`);
    for (const line of tile.lines) {
      lines.push(
        `tile-line:${tile.key}:${line.key}:${value(line.value)}|${raws(line.value)}`,
      );
    }
  }
  if (entries.dailyOutput.totalTile) {
    lines.push(`tile-total:${value(entries.dailyOutput.totalTile.main)}`);
  }
  if (entries.dailyOutput.warning) {
    lines.push(`daily-warning:${entries.dailyOutput.warning}`);
  }
  lines.push(`strategy:${entries.droneStrategy.label}`);
  lines.push(`strategy-hint:${entries.droneStrategy.hint}`);
  for (const scenario of entries.droneScenarios) {
    lines.push(`scenario:${value(scenario.title)}:${value(scenario.meta)}`);
    lines.push(`scenario-base:${value(scenario.baseRate)}`);
    for (const view of scenario.views) {
      lines.push(
        `scenario-view:${view.key}:${view.label}:${view.tiles.length}`,
      );
      for (const tile of view.tiles) {
        lines.push(
          `scenario-tile:${tile.key}:${value(tile.main)}|${raws(tile.main)}`,
        );
      }
    }
  }
  const steps = entries.calculationSteps;
  lines.push(`steps:${steps.label}:${steps.hint}`);
  if (steps.maaDrone) {
    lines.push(`pane:${steps.maaDrone.key}:${steps.maaDrone.label}`);
    lines.push(`pane-hint:${value(steps.maaDrone.hint)}`);
    for (const card of steps.maaDrone.cards) {
      lines.push(
        `card:${value(card.title)}|${value(card.subtitle)}|${value(card.badge)}|${card.empty ?? ""}`,
      );
      for (const section of card.sections) {
        lines.push(`section:${section.label ?? ""}`);
        for (const row of section.rows) {
          lines.push(
            `row:${value(row.label)}|${value(row.value)}|${raws(row.value)}`,
          );
        }
        for (const entry of section.entries ?? []) {
          lines.push(
            `entry:${value(entry.title)}|${value(entry.value)}|${(entry.cells ?? []).map((cell) => value(cell)).join(" || ")}`,
          );
          for (const row of entry.rows) {
            lines.push(
              `entry-row:${value(row.label)}|${value(row.value)}|${raws(row.value)}`,
            );
          }
        }
        for (const child of section.sections ?? []) {
          lines.push(`subsection:${child.label ?? ""}`);
          for (const row of child.rows) {
            lines.push(
              `subrow:${value(row.label)}|${value(row.value)}|${raws(row.value)}`,
            );
          }
        }
      }
    }
  }
  if (steps.dailyOutput) {
    lines.push(`pane:${steps.dailyOutput.key}:${steps.dailyOutput.label}`);
    lines.push(`pane-hint:${value(steps.dailyOutput.hint)}`);
    for (const card of steps.dailyOutput.cards) {
      lines.push(
        `card:${value(card.title)}|${value(card.subtitle)}|${value(card.badge)}`,
      );
      for (const section of card.sections) {
        lines.push(`section:${section.label ?? ""}`);
        for (const row of section.rows) {
          lines.push(
            `row:${value(row.label)}|${value(row.value)}|${raws(row.value)}`,
          );
        }
        for (const child of section.sections ?? []) {
          lines.push(`subsection:${child.label ?? ""}`);
          for (const row of child.rows) {
            lines.push(
              `subrow:${value(row.label)}|${value(row.value)}|${raws(row.value)}`,
            );
          }
        }
      }
    }
  }
  if (steps.basePoints) {
    lines.push(`pane:${steps.basePoints.key}:${steps.basePoints.label}`);
    for (const column of steps.basePoints.columns) {
      lines.push(
        `card:${value(column.title)}|${value(column.subtitle)}|${column.empty}`,
      );
      for (const point of column.points) {
        lines.push(`point:${value(point.name)}|${value(point.value)}`);
        for (const source of point.sources) {
          lines.push(`source:${value(source.label)}|${value(source.value)}`);
        }
      }
    }
  }
  const facilitySteps = steps.facilitySteps;
  lines.push(
    `plans:${facilitySteps.plans.map((plan) => `${plan.planIndex}:${plan.name}:${plan.durationHours}`).join("|")}`,
  );
  for (const step of facilitySteps.steps) {
    lines.push(
      `step:${step.key}:${step.planIndex}:${step.facilityId ?? ""}:${step.facilityLabel}:${step.inheritedLabel ?? ""}:${step.efficiency ?? ""}:${step.emptyNote ?? ""}`,
    );
    for (const section of step.sections) {
      lines.push(`section:${section.label ?? ""}`);
      for (const row of section.rows) {
        lines.push(
          `row:${value(row.label)}|${value(row.value)}|${raws(row.value)}`,
        );
      }
      for (const entry of section.entries ?? []) {
        lines.push(`entry:${value(entry.title)}|${value(entry.value)}`);
        for (const row of entry.rows) {
          lines.push(
            `entry-row:${value(row.label)}|${value(row.value)}|${raws(row.value)}`,
          );
        }
      }
      for (const child of section.sections ?? []) {
        lines.push(`subsection:${child.label ?? ""}`);
        for (const row of child.rows) {
          lines.push(
            `subrow:${value(row.label)}|${value(row.value)}|${raws(row.value)}`,
          );
        }
      }
    }
  }
  for (const pane of packageModule.buildFacilityStepPanes(facilitySteps)) {
    lines.push(
      `pane:${pane.key}:${pane.label}:${value(pane.badge)}:${pane.cards.length}`,
    );
    for (const card of pane.cards) {
      lines.push(
        `card:${value(card.title)}|${value(card.subtitle)}|${value(card.badge)}|${card.empty ?? ""}|${card.emptyNote ?? ""}`,
      );
    }
  }
  for (const card of packageModule.buildFacilityStepCards(facilitySteps)) {
    lines.push(
      `queue-card:${value(card.title)}|${value(card.subtitle)}|${value(card.badge)}|${card.emptyNote ?? ""}:${card.sections.length}`,
    );
  }
  return lines;
}

const actual = flatten(display);

if (process.argv[2] === "--write") {
  await mkdir(path.dirname(goldenPath), { recursive: true });
  await writeFile(goldenPath, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
  console.log(`wrote golden: ${goldenPath} (${actual.length} lines)`);
} else {
  const expected = JSON.parse(await readFile(goldenPath, "utf8"));
  assert.deepEqual(actual, expected);
  console.log(
    `result display regression: passed (${expected.length} lines pinned)`,
  );
}
