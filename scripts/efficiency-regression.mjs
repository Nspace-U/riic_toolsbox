import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageRoot = path.join(projectRoot, "packages", "riic-efficiency");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadRuntime() {
  const packageModule = await import(
    pathToFileURL(path.join(packageRoot, "dist", "index.js")).href
  );
  const vite = await createServer({
    root: projectRoot,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    logLevel: "error",
  });
  try {
    const [maaModule, operatorFileNames] = await Promise.all([
      vite.ssrLoadModule("/src/adapters/maaSchedule.ts"),
      readdir(path.join(packageRoot, "data", "operators")),
    ]);
    const skillFiles = await Promise.all(
      operatorFileNames
        .filter((fileName) => fileName.endsWith(".json"))
        .map(async (fileName) =>
          readJson(path.join(packageRoot, "data", "operators", fileName)),
        ),
    );
    const termsData = await readJson(
      path.join(packageRoot, "data", "terms.json"),
    );
    const catalog = packageModule.createEfficiencyCatalog(
      skillFiles,
      termsData.terms,
    );
    function withSettings(document, options = {}) {
      return {
        ...document,
        settings: {
          ...document.settings,
          ...(options.progressionProfile === undefined
            ? {}
            : { progressionProfile: options.progressionProfile }),
          ...(options.treatSkillsAsUnlocked === undefined
            ? {}
            : { treatSkillsAsUnlocked: options.treatSkillsAsUnlocked }),
          ...(options.dormitoryDefaultIncludesMoodRecovery === undefined
            ? {}
            : {
                dormitoryDefaultIncludesMoodRecovery:
                  options.dormitoryDefaultIncludesMoodRecovery,
              }),
        },
      };
    }
    return {
      calculateEfficiency: (document, currentCatalog, options = {}) =>
        packageModule.calculateEfficiency(withSettings(document, options), {
          catalog: currentCatalog,
          ruleset: options.ruleset ?? currentCatalog.ruleset,
        }),
      calculateDroneAcceleration: (
        document,
        currentCatalog,
        amounts,
        options = {},
      ) =>
        packageModule.calculateDroneAcceleration(
          withSettings(document, options),
          currentCatalog,
          amounts,
          {
            ...options,
            ruleset: options.ruleset ?? currentCatalog.ruleset,
          },
        ),
      aggregateDailyOutputs: packageModule.aggregateDailyOutputs,
      parseLmdDroneStrategy: packageModule.parseLmdDroneStrategy,
      parseMaaScheduleText: maaModule.parseMaaScheduleText,
      serializeMaaSchedule: maaModule.serializeMaaSchedule,
      catalog,
      close: () => vite.close(),
    };
  } catch (error) {
    await vite.close();
    throw error;
  }
}

function fiammettaDocument({ plans, mode, fiammetta }) {
  return {
    layout: [
      { type: "control", level: 5 },
      { type: "trading", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "dormitory", level: 5 },
    ],
    settings: { fiammettaMode: mode, fiammettaDirectCount: 3 },
    fiammetta,
    plans,
  };
}

function fiammettaAssignment(operators) {
  return {
    operators,
    operatorStates: Object.fromEntries(
      operators.map((name) => [name, { elite: 2, level: 1, mood: 24 }]),
    ),
  };
}

function assignment(operators, eliteLevels, moods = {}) {
  return {
    operators: [...operators],
    operatorStates: Object.fromEntries(
      operators.map((name) => [
        name,
        {
          elite: eliteLevels[name] ?? 2,
          level: 1,
          mood: moods[name] ?? 24,
        },
      ]),
    ),
  };
}

function assignmentWithoutMood(operators) {
  return {
    operators: [...operators],
  };
}

function assignmentWithoutMoodAtElite(operators, elite = 2) {
  return {
    operators: [...operators],
    operatorStates: Object.fromEntries(
      operators.map((name) => [name, { elite, level: 1 }]),
    ),
  };
}

function catalogWithManufactureSkill(catalog, name, effects) {
  const skillFile = {
    id: `test_${name}`,
    name,
    chains: [
      {
        slot: 1,
        room: "manufacture",
        stages: [
          {
            unlock: { type: "elite", value: 0 },
            name: "测试技能",
            effects,
          },
        ],
      },
    ],
  };
  return {
    ...catalog,
    operators: {
      ...catalog.operators,
      [name]: {
        id: skillFile.id,
        name,
        maxEliteLevel: 2,
        rarity: 1,
        skillFile,
        skillNames: ["测试技能"],
      },
    },
  };
}

function documentFor({
  control = [],
  trading = [],
  manufacture = [],
  eliteLevels = {},
  moods = {},
  duration = 720,
  tradingProduct,
  settings = {},
}) {
  return {
    layout: [
      { type: "control", level: 5 },
      { type: "trading", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "power", level: 3 },
      { type: "power", level: 3 },
      { type: "power", level: 3 },
    ],
    plans: [
      {
        duration,
        rooms: {
          control: [assignment(control, eliteLevels, moods)],
          trading: [
            {
              ...assignment(trading, eliteLevels, moods),
              ...(tradingProduct ? { product: tradingProduct } : {}),
            },
          ],
          manufacture: [
            {
              ...assignment(manufacture, eliteLevels, moods),
              product: "赤金",
            },
          ],
          power: [
            assignment([], eliteLevels),
            assignment([], eliteLevels),
            assignment([], eliteLevels),
          ],
        },
      },
    ],
    settings,
  };
}

function percentageFacilityDocument(type, operators) {
  const room = assignment(operators, {});
  if (type === "manufacture") {
    room.product = "赤金";
  }
  return {
    layout: [
      { type: "control", level: 5 },
      { type, level: 3 },
    ],
    plans: [
      {
        duration: 720,
        rooms: {
          control: [assignment([], {})],
          [type]: [room],
        },
      },
    ],
  };
}

function abyssalDocument({
  manufacture,
  control = ["歌蕾蒂娅"],
  dormitory = [],
  eliteLevels = {},
  moods = {},
}) {
  return {
    layout: [
      { type: "control", level: 5 },
      { type: "manufacture", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "dormitory", level: 5 },
    ],
    plans: [
      {
        duration: 720,
        rooms: {
          control: [assignment(control, eliteLevels, moods)],
          manufacture: manufacture.map((operators) => ({
            ...assignment(operators, eliteLevels, moods),
            product: "赤金",
          })),
          dormitory: [assignment(dormitory, eliteLevels, moods)],
        },
      },
    ],
  };
}

function flowGoldDocument({
  trading = [],
  control = [],
  manufactureCount = 1,
  eliteLevels = {},
  moods = {},
}) {
  return {
    layout: [
      { type: "control", level: 5 },
      { type: "trading", level: 3 },
      ...Array.from({ length: manufactureCount }, () => ({
        type: "manufacture",
        level: 3,
      })),
    ],
    plans: [
      {
        duration: 720,
        rooms: {
          control: [assignment(control, eliteLevels, moods)],
          trading: [assignment(trading, eliteLevels, moods)],
          manufacture: Array.from({ length: manufactureCount }, () => ({
            ...assignment([], eliteLevels, moods),
            product: "赤金",
          })),
        },
      },
    ],
  };
}

function multipleTradingDocument({ trading, control = [] }) {
  return {
    layout: [
      { type: "control", level: 5 },
      { type: "trading", level: 3 },
      { type: "trading", level: 3 },
    ],
    plans: [
      {
        duration: 720,
        rooms: {
          control: [assignment(control, {})],
          trading: trading.map((operators) => assignment(operators, {})),
        },
      },
    ],
  };
}

function tradingWithRoomDocument({ trading, room, roomOperators }) {
  return {
    layout: [
      { type: "control", level: 5 },
      { type: "trading", level: 3 },
      { type: room, level: 3 },
    ],
    plans: [
      {
        duration: 720,
        rooms: {
          control: [assignment([], {})],
          trading: [assignment(trading, {})],
          [room]: [assignment(roomOperators, {})],
        },
      },
    ],
  };
}

function dailyOutputDocument(settings = {}) {
  return {
    layout: [
      { type: "control", level: 5 },
      { type: "trading", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "power", level: 3 },
      { type: "power", level: 3 },
      { type: "power", level: 3 },
      { type: "meeting", level: 3 },
      { type: "hire", level: 3 },
      { type: "dormitory", level: 5 },
      { type: "dormitory", level: 1 },
    ],
    plans: [
      {
        duration: 720,
        rooms: {
          trading: [{ ...assignment(["温蒂"], {}), product: "合成玉" }],
          manufacture: [{ ...assignment(["砾"], {}), product: "赤金" }],
          power: [
            assignment(["Lancet-2"], {}),
            assignment([], {}),
            assignment([], {}),
          ],
          meeting: [assignment(["夜烟"], {})],
          hire: [assignment(["琴柳"], {})],
        },
      },
    ],
    settings,
  };
}

function droneDocument(strategy = "1 但书0") {
  return {
    layout: [
      { type: "control", level: 5 },
      { type: "trading", level: 1 },
      { type: "trading", level: 2 },
      { type: "manufacture", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "manufacture", level: 3 },
    ],
    plans: [
      {
        duration: 720,
        rooms: {
          trading: [{ product: "龙门币" }, { product: "合成玉" }],
          manufacture: [
            { product: "赤金" },
            { product: "中级作战记录" },
            { product: "源石碎片", sourceMaterial: "固源岩" },
          ],
        },
      },
    ],
    settings: { lmdDroneStrategy: strategy },
  };
}

function manufactureResult(result) {
  const facility = result.plans[0].facilities.find(
    ({ facility: value }) => value.type === "manufacture",
  );
  assert.ok(facility);
  return facility;
}

function tradingResult(result) {
  const facility = result.plans[0].facilities.find(
    ({ facility: value }) => value.type === "trading",
  );
  assert.ok(facility);
  return facility;
}

function facilityResult(result, type) {
  const facility = result.plans[0].facilities.find(
    ({ facility: value }) => value.type === type,
  );
  assert.ok(facility);
  return facility;
}

function assertSkillDetails(result, operators) {
  assert.deepEqual(
    [...new Set(result.combinationDetails.map((detail) => detail.operator))],
    operators,
  );
}

function runTests(runtime) {
  const {
    aggregateDailyOutputs,
    calculateDroneAcceleration,
    calculateEfficiency,
    catalog,
    parseLmdDroneStrategy,
    parseMaaScheduleText,
    serializeMaaSchedule,
  } = runtime;

  const bobbDormitory = calculateEfficiency(
    {
      layout: [
        { type: "control", level: 5 },
        { type: "dormitory", level: 5 },
      ],
      plans: [
        {
          duration: 720,
          rooms: {
            control: [assignment([], {})],
            dormitory: [assignment(["波卜"], { 波卜: 2 }, { 波卜: 23 })],
          },
        },
      ],
    },
    catalog,
  );
  const bobbRecovery =
    bobbDormitory.plans[0]?.dormitoryRecoveries[0]?.operators.find(
      ({ operator }) => operator === "波卜",
    );
  const bobbContributions = bobbRecovery?.contributions.filter(
    ({ operator }) => operator === "波卜",
  );
  assert.deepEqual(
    bobbContributions?.map(({ skill }) => skill),
    ["倾谈者"],
  );
  assert.ok(Math.abs((bobbContributions?.[0]?.value ?? 0) - 0.21) < 1e-9);
  assert.equal(bobbRecovery?.rate, 4.21);

  const senshiDungeonDormitory = calculateEfficiency(
    {
      layout: [
        { type: "control", level: 5 },
        { type: "dormitory", level: 5 },
      ],
      plans: [
        {
          duration: 720,
          rooms: {
            control: [assignment([], {})],
            dormitory: [
              assignment(
                ["森西", "断罪者", "莱欧斯", "玛露西尔"],
                { 森西: 2, 断罪者: 0, 莱欧斯: 0, 玛露西尔: 0 },
                { 莱欧斯: 0 },
              ),
            ],
          },
        },
      ],
    },
    catalog,
  );
  const laiosRecovery =
    senshiDungeonDormitory.plans[0]?.dormitoryRecoveries[0]?.operators.find(
      ({ operator }) => operator === "莱欧斯",
    );
  assert.deepEqual(
    laiosRecovery?.contributions.map(
      ({ operator, skill, distribution, value }) => [
        operator,
        skill,
        distribution,
        value,
      ],
    ),
    [
      ["森西", "资深料理人", "shared", 0.15],
      ["森西", "资深料理人", "shared", 0.15],
      ["断罪者", "天启", "single", 0.7],
    ],
  );
  assert.equal(laiosRecovery?.rate, 5.0);
  const executorRecovery =
    senshiDungeonDormitory.plans[0]?.dormitoryRecoveries[0]?.operators.find(
      ({ operator }) => operator === "断罪者",
    );
  assert.equal(executorRecovery?.rate, 4.15);

  const morganDormitory = calculateEfficiency(
    {
      layout: [
        { type: "control", level: 5 },
        { type: "dormitory", level: 5 },
      ],
      plans: [
        {
          duration: 720,
          rooms: {
            control: [assignment([], {})],
            dormitory: [
              assignment(
                ["摩根", "推进之王", "因陀罗", "阿米娅"],
                {},
                { 摩根: 24, 推进之王: 10, 因陀罗: 8, 阿米娅: 5 },
              ),
            ],
          },
        },
      ],
    },
    catalog,
  );
  const morganDormitoryRecovery =
    morganDormitory.plans[0]?.dormitoryRecoveries[0];
  const siegeRecovery = morganDormitoryRecovery?.operators.find(
    ({ operator }) => operator === "推进之王",
  );
  assert.equal(siegeRecovery?.rate, 4.5);
  assert.ok(
    siegeRecovery?.contributions.some(
      ({ operator, skill, value }) =>
        operator === "摩根" && skill === "头号陪练" && value === 0.3,
    ),
  );
  const indraRecovery = morganDormitoryRecovery?.operators.find(
    ({ operator }) => operator === "因陀罗",
  );
  assert.equal(indraRecovery?.rate, 4.5);
  assert.ok(
    indraRecovery?.contributions.some(
      ({ operator, skill, value }) =>
        operator === "摩根" && skill === "头号陪练" && value === 0.3,
    ),
  );

  const morganVendlaDormitory = calculateEfficiency(
    {
      layout: [
        { type: "control", level: 5 },
        { type: "dormitory", level: 5 },
      ],
      plans: [
        {
          duration: 720,
          rooms: {
            control: [assignment([], {})],
            dormitory: [
              assignment(
                ["摩根", "刺玫", "推进之王", "因陀罗"],
                {},
                { 摩根: 24, 刺玫: 24, 推进之王: 10, 因陀罗: 10 },
              ),
            ],
          },
        },
      ],
    },
    catalog,
  );
  const lowMoodSiegeRecovery =
    morganVendlaDormitory.plans[0]?.dormitoryRecoveries[0]?.operators.find(
      ({ operator }) => operator === "推进之王",
    );
  assert.equal(lowMoodSiegeRecovery?.rate, 4.5);
  assert.deepEqual(
    lowMoodSiegeRecovery?.contributions
      .filter(({ operator }) => operator === "摩根" || operator === "刺玫")
      .map(({ operator, value }) => [operator, value]),
    [["摩根", 0.3]],
  );

  const crossDormitoryRecovery = calculateEfficiency(
    {
      layout: [
        { type: "control", level: 5 },
        { type: "dormitory", level: 5 },
      ],
      plans: [
        {
          duration: 720,
          rooms: {
            control: [assignment(["红隼", "电弧"], {})],
            dormitory: [assignment(["推进之王", "煌"], {})],
          },
        },
      ],
    },
    catalog,
  );
  const crossDormitoryOperator =
    crossDormitoryRecovery.plans[0]?.dormitoryRecoveries[0]?.operators.find(
      ({ operator }) => operator === "煌",
    );
  assert.equal(crossDormitoryOperator?.rate, 4.3);
  assert.deepEqual(
    crossDormitoryOperator?.contributions.map(({ operator, value }) => [
      operator,
      value,
    ]),
    [
      ["电弧", 0.1],
      ["推进之王", 0.2],
    ],
  );

  const maaDroneDocument = {
    layout: [
      { type: "power", level: 3 },
      { type: "trading", level: 3 },
      { type: "manufacture", level: 3 },
    ],
    plans: [
      {
        duration: 720,
        drones: {
          enable: true,
          room: "trading",
          index: 0,
          rule: "all",
          order: "pre",
        },
        rooms: {
          power: [{ operators: ["Lancet-2"] }],
          trading: [{ operators: ["但书"], product: "龙门币" }],
          manufacture: [{ operators: ["温蒂"], product: "赤金" }],
        },
      },
      {
        duration: 720,
        rooms: {
          power: [{ operators: ["Lancet-2"] }],
          trading: [{ operators: ["但书"], product: "合成玉" }],
          manufacture: [{ operators: ["温蒂"], product: "赤金" }],
        },
      },
      {
        duration: 720,
        drones: {
          enable: true,
          room: "manufacture",
          index: 0,
          rule: "all",
          order: "post",
        },
        rooms: {
          power: [{ operators: ["Lancet-2"] }],
          trading: [{ operators: ["但书"], product: "龙门币" }],
          manufacture: [{ operators: ["温蒂"], product: "中级作战记录" }],
        },
      },
    ],
    settings: { droneOverflowMode: "zero" },
  };
  const maaDroneResult = calculateEfficiency(maaDroneDocument, catalog);
  assert.equal(maaDroneResult.maaDroneAcceleration?.enabled, true);
  assert.equal(maaDroneResult.maaDroneAcceleration?.details.length, 2);
  assert.equal(
    maaDroneResult.maaDroneAcceleration?.details[0]?.sourcePlanIndex,
    2,
  );
  assert.equal(
    maaDroneResult.maaDroneAcceleration?.details[1]?.sourcePlanIndex,
    2,
  );
  assert.equal(
    maaDroneResult.dailyOutputs.some(({ product }) => product === "无人机"),
    false,
  );
  assert.deepEqual(maaDroneResult.maaDroneAcceleration?.warnings, []);
  const maaCandidates = maaDroneResult.maaDroneAcceleration?.candidates ?? [];
  assert.equal(maaCandidates.length, 4);
  const firstPlanCandidates = maaCandidates.filter(
    (candidate) => candidate.planIndex === 0,
  );
  assert.deepEqual(
    firstPlanCandidates.map((candidate) => candidate.facilityId),
    ["trading-1", "manufacture-1"],
  );
  assert.equal(firstPlanCandidates[0]?.accelerated, true);
  assert.equal(firstPlanCandidates[0]?.room, "trading");
  assert.equal(firstPlanCandidates[0]?.product, "龙门币");
  assert.equal(firstPlanCandidates[0]?.sourcePlanIndex, 2);
  assert.equal(
    firstPlanCandidates[0]?.extraAmount,
    maaDroneResult.maaDroneAcceleration?.details[0]?.extraAmount,
  );
  assert.equal(firstPlanCandidates[1]?.accelerated, false);
  assert.equal(firstPlanCandidates[1]?.room, "manufacture");
  assert.equal(
    firstPlanCandidates[1]?.extraAmount,
    (firstPlanCandidates[1]?.baseAmountPerHour ?? 0) *
      (firstPlanCandidates[1]?.acceleratedHours ?? 0),
  );
  assert.equal(
    maaCandidates.some((candidate) => candidate.planIndex === 1),
    false,
  );
  const thirdPlanCandidates = maaCandidates.filter(
    (candidate) => candidate.planIndex === 2,
  );
  assert.deepEqual(
    thirdPlanCandidates.map((candidate) => candidate.facilityId),
    ["manufacture-1", "trading-1"],
  );
  assert.equal(thirdPlanCandidates[0]?.accelerated, true);
  assert.equal(thirdPlanCandidates[0]?.product, "中级作战记录");

  const candidateDocument = {
    layout: [
      { type: "power", level: 3 },
      { type: "trading", level: 3 },
      { type: "trading", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "manufacture", level: 3 },
    ],
    plans: [
      {
        duration: 1440,
        drones: {
          enable: true,
          room: "trading",
          index: 0,
          rule: "all",
          order: "post",
        },
        rooms: {
          power: [{ operators: ["Lancet-2"] }],
          trading: [
            { operators: ["巫恋"], product: "龙门币" },
            { operators: ["但书"], product: "龙门币" },
          ],
          manufacture: [
            {
              operators: ["温蒂"],
              product: "源石碎片",
              sourceMaterial: "固源岩",
            },
            {
              operators: ["帕拉斯"],
              product: "源石碎片",
              sourceMaterial: "装置",
            },
          ],
        },
      },
    ],
  };
  const candidateResult = calculateEfficiency(candidateDocument, catalog);
  const facilityCandidates =
    candidateResult.maaDroneAcceleration?.candidates ?? [];
  assert.equal(facilityCandidates.length, 4);
  assert.equal(facilityCandidates[0]?.accelerated, true);
  assert.equal(facilityCandidates[0]?.room, "trading");
  assert.equal(facilityCandidates[0]?.facilityIndex, 0);
  const lmdCandidates = facilityCandidates.filter(
    (candidate) => candidate.product === "龙门币",
  );
  assert.equal(lmdCandidates.length, 2);
  assert.notEqual(
    lmdCandidates[0]?.baseAmountPerHour,
    lmdCandidates[1]?.baseAmountPerHour,
  );
  const shardCandidates = facilityCandidates.filter(
    (candidate) => candidate.product === "源石碎片",
  );
  assert.equal(shardCandidates.length, 2);
  assert.deepEqual(
    shardCandidates.map((candidate) => candidate.accelerated),
    [false, false],
  );
  assert.notDeepEqual(
    shardCandidates[0]?.extraMaterial,
    shardCandidates[1]?.extraMaterial,
  );
  assert.equal(
    (candidateResult.maaDroneAcceleration?.details.length ?? 0) > 0,
    true,
  );

  const overflowResult = calculateEfficiency(
    {
      ...maaDroneDocument,
      plans: maaDroneDocument.plans.map((plan) => ({
        ...plan,
        duration: 1440,
      })),
    },
    catalog,
  );
  assert.ok(overflowResult.maaDroneAcceleration?.warnings.length);
  assert.equal(
    overflowResult.maaDroneAcceleration?.warnings.every(
      (warning) => warning.code === "overflow",
    ),
    true,
  );

  const invalidTargetResult = calculateEfficiency(
    {
      ...maaDroneDocument,
      plans: maaDroneDocument.plans.map((plan, planIndex) =>
        planIndex === 0
          ? { ...plan, drones: { ...plan.drones, index: 5 } }
          : plan,
      ),
    },
    catalog,
  );
  assert.equal(
    invalidTargetResult.maaDroneAcceleration?.warnings.some(
      (warning) => warning.code === "invalidTarget",
    ),
    true,
  );
  assert.equal(
    invalidTargetResult.maaDroneAcceleration?.details.some(
      (detail) => detail.planIndex === 0,
    ),
    false,
  );
  assert.equal(
    invalidTargetResult.maaDroneAcceleration?.candidates.some(
      (candidate) => candidate.planIndex === 0,
    ),
    false,
  );

  const emptyTargetResult = calculateEfficiency(
    {
      layout: [
        { type: "power", level: 3 },
        { type: "trading", level: 3 },
        { type: "manufacture", level: 3 },
      ],
      plans: [
        {
          duration: 1440,
          drones: {
            enable: true,
            room: "manufacture",
            index: 0,
            rule: "all",
            order: "post",
          },
          rooms: {
            power: [{ operators: ["Lancet-2"] }],
            trading: [{ operators: ["但书"], product: "龙门币" }],
            manufacture: [{}],
          },
        },
      ],
    },
    catalog,
  );
  assert.deepEqual(
    emptyTargetResult.maaDroneAcceleration?.warnings.map(({ code }) => code),
    ["noProduction"],
  );
  assert.equal(emptyTargetResult.maaDroneAcceleration?.enabled, false);
  assert.equal(emptyTargetResult.maaDroneAcceleration?.candidates.length, 0);
  const parsedDroneStrategy = parseLmdDroneStrategy(
    "3 巫恋 龙舌兰2 但书0",
    catalog,
  );
  assert.equal(parsedDroneStrategy.strategy?.level, 3);
  assert.deepEqual(parsedDroneStrategy.strategy?.operators, [
    "巫恋",
    "龙舌兰",
    "但书",
  ]);
  assert.equal(parsedDroneStrategy.strategy?.operatorStates.龙舌兰?.elite, 2);
  assert.equal(parsedDroneStrategy.strategy?.operatorStates.但书?.elite, 0);

  const droneAcceleration = calculateDroneAcceleration(
    droneDocument("1"),
    catalog,
    { 无人机: 240 },
  );
  assert.equal(droneAcceleration.acceleratedHours, 12);
  const droneScenario = (product) =>
    droneAcceleration.scenarios.find(
      (scenario) => scenario.product === product,
    );
  const lmdDroneScenario = droneScenario("龙门币");
  assert.ok(lmdDroneScenario);
  assert.ok(Math.abs(lmdDroneScenario.extraFlow.龙门币 - 5000) < 1e-9);
  assert.ok(Math.abs(lmdDroneScenario.extraFlow.赤金 + 10) < 1e-9);
  assert.equal(lmdDroneScenario.extraFlow.无人机, -240);
  const orundumDroneScenario = droneScenario("合成玉");
  assert.ok(orundumDroneScenario);
  assert.ok(Math.abs(orundumDroneScenario.extraFlow.合成玉 - 120) < 1e-9);
  assert.ok(Math.abs(orundumDroneScenario.extraFlow.源石碎片 + 12) < 1e-9);
  const pureGoldDroneScenario = droneScenario("赤金");
  assert.ok(pureGoldDroneScenario);
  assert.ok(Math.abs(pureGoldDroneScenario.extraFlow.赤金 - 10) < 1e-9);
  const battleRecordDroneScenario = droneScenario("中级作战记录");
  assert.ok(battleRecordDroneScenario);
  assert.ok(
    Math.abs(battleRecordDroneScenario.extraFlow.中级作战记录 - 4) < 1e-9,
  );
  const shardDroneScenario = droneScenario("源石碎片");
  assert.ok(shardDroneScenario);
  assert.ok(Math.abs(shardDroneScenario.extraFlow.源石碎片 - 12) < 1e-9);
  assert.ok(Math.abs(shardDroneScenario.extraFlow.固源岩 + 24) < 1e-9);
  assert.ok(Math.abs(shardDroneScenario.extraFlow.龙门币 + 19200) < 1e-9);

  const efficientDroneDocument = droneDocument("1");
  efficientDroneDocument.plans[0].rooms.manufacture[0].operators = ["温蒂"];
  const efficientManufacture = calculateEfficiency(
    efficientDroneDocument,
    catalog,
  ).plans[0].facilities.find(
    ({ facility }) => facility.type === "manufacture" && facility.index === 0,
  );
  assert.ok(efficientManufacture?.production);
  assert.ok(
    (efficientManufacture.production?.amountPerHour ?? 0) >
      pureGoldDroneScenario.baseAmountPerHour,
  );
  const efficientDroneScenario = calculateDroneAcceleration(
    efficientDroneDocument,
    catalog,
    { 无人机: 240 },
  ).scenarios.find((scenario) => scenario.product === "赤金");
  assert.ok(efficientDroneScenario);
  assert.equal(efficientDroneScenario.baseAmountPerHour, 1 / 1.2);
  assert.equal(efficientDroneScenario.extraFlow.赤金, 10);

  const duplicateProductDocument = droneDocument("1");
  duplicateProductDocument.plans[0].rooms.manufacture[1].product = "赤金";
  const duplicateProductScenarios = calculateDroneAcceleration(
    duplicateProductDocument,
    catalog,
    { 无人机: 240 },
  ).scenarios.filter((scenario) => scenario.product === "赤金");
  assert.equal(duplicateProductScenarios.length, 1);
  assert.equal(duplicateProductScenarios[0].sourceLabel, "队列1 · 制造站1");
  assert.equal(duplicateProductScenarios[0].baseAmountPerHour, 1 / 1.2);
  assert.equal(duplicateProductScenarios[0].extraFlow.赤金, 10);

  const crossQueueDocument = droneDocument("1");
  crossQueueDocument.plans.push({
    duration: 720,
    rooms: {
      trading: [{ product: "龙门币" }, { product: "合成玉" }],
      manufacture: [
        { product: "赤金" },
        { product: "中级作战记录" },
        { product: "源石碎片", sourceMaterial: "固源岩" },
      ],
    },
  });
  const crossQueueScenarios = calculateDroneAcceleration(
    crossQueueDocument,
    catalog,
    { 无人机: 240 },
  ).scenarios.filter((scenario) => scenario.product === "赤金");
  assert.equal(crossQueueScenarios.length, 1);
  assert.equal(crossQueueScenarios[0].sourceLabel, "队列1 · 制造站1");
  assert.equal(crossQueueScenarios[0].baseAmountPerHour, 1 / 1.2);
  assert.equal(crossQueueScenarios[0].extraFlow.赤金, 10);

  const legacyProductDocument = droneDocument("1");
  legacyProductDocument.plans[0].rooms.trading[0].product = "LMD";
  legacyProductDocument.plans[0].rooms.trading[1].product = "Orundum";
  legacyProductDocument.plans[0].rooms.manufacture[0].product = "Pure Gold";
  legacyProductDocument.plans[0].rooms.manufacture[1].product = "Battle Record";
  legacyProductDocument.plans[0].rooms.manufacture[2].product =
    "Originium Shard";
  const legacyProductScenarios = calculateDroneAcceleration(
    legacyProductDocument,
    catalog,
    { 无人机: 240 },
  ).scenarios;
  assert.ok(
    legacyProductScenarios.some((scenario) => scenario.product === "龙门币"),
  );
  assert.ok(
    legacyProductScenarios.some((scenario) => scenario.product === "合成玉"),
  );
  assert.ok(
    legacyProductScenarios.some((scenario) => scenario.product === "赤金"),
  );
  assert.ok(
    legacyProductScenarios.some(
      (scenario) => scenario.product === "中级作战记录",
    ),
  );
  assert.ok(
    legacyProductScenarios.some((scenario) => scenario.product === "源石碎片"),
  );

  const danshuDroneAcceleration = calculateDroneAcceleration(
    droneDocument("1 但书0"),
    catalog,
    { 无人机: 240 },
  );
  const danshuDroneScenario = danshuDroneAcceleration.scenarios.find(
    (scenario) => scenario.product === "龙门币",
  );
  assert.ok(danshuDroneScenario);
  assert.equal(danshuDroneScenario.extraFlow.龙门币, 7500);
  assert.equal(danshuDroneScenario.extraFlow.赤金, -15);

  const defaultDroneStrategies = {
    1: "1 但书0",
    2: "2",
    3: "3",
  };
  const automaticDroneAcceleration = calculateDroneAcceleration(
    droneDocument(""),
    catalog,
    { 无人机: 240 },
    { lmdDroneStrategies: defaultDroneStrategies },
  );
  const automaticLmdScenario = automaticDroneAcceleration.scenarios.find(
    (scenario) => scenario.product === "龙门币",
  );
  assert.ok(automaticLmdScenario);
  assert.equal(automaticLmdScenario.extraFlow.龙门币, 7500);

  const levelTwoDocument = droneDocument("");
  levelTwoDocument.layout = levelTwoDocument.layout.filter(
    (entry) => entry.type !== "trading" || entry.level !== 1,
  );
  const levelTwoAutomatic = calculateDroneAcceleration(
    levelTwoDocument,
    catalog,
    { 无人机: 240 },
    { lmdDroneStrategies: defaultDroneStrategies },
  );
  const levelTwoScenario = levelTwoAutomatic.scenarios.find(
    (scenario) => scenario.product === "龙门币",
  );
  const levelTwoExplicit = calculateDroneAcceleration(
    droneDocument("2"),
    catalog,
    { 无人机: 240 },
  ).scenarios.find((scenario) => scenario.product === "龙门币");
  assert.ok(levelTwoScenario);
  assert.ok(levelTwoExplicit);
  assert.equal(
    levelTwoScenario.extraFlow.龙门币,
    levelTwoExplicit.extraFlow.龙门币,
  );

  const invalidDefault = calculateDroneAcceleration(
    droneDocument(""),
    catalog,
    { 无人机: 240 },
    { lmdDroneStrategies: { 1: "2", 2: "2", 3: "3" } },
  );
  assert.equal(invalidDefault.strategyError, "1级贸易站策略必须以“1”开头");

  const noTradingDocument = droneDocument("");
  noTradingDocument.layout = noTradingDocument.layout.filter(
    (entry) => entry.type !== "trading",
  );
  const noTradingAcceleration = calculateDroneAcceleration(
    noTradingDocument,
    catalog,
    { 无人机: 240 },
    { lmdDroneStrategies: defaultDroneStrategies },
  );
  assert.equal(
    noTradingAcceleration.scenarios.find(
      (scenario) => scenario.product === "龙门币",
    ),
    undefined,
  );

  const overriddenDroneAcceleration = calculateDroneAcceleration(
    droneDocument("1 但书0"),
    catalog,
    { 无人机: 240 },
    { lmdDroneStrategies: { 1: "1", 2: "2", 3: "3" } },
  );
  const overriddenLmdScenario = overriddenDroneAcceleration.scenarios.find(
    (scenario) => scenario.product === "龙门币",
  );
  assert.ok(overriddenLmdScenario);
  assert.equal(overriddenLmdScenario.extraFlow.龙门币, 7500);

  const partial = calculateEfficiency(
    documentFor({
      manufacture: ["温蒂", "未知干员"],
      eliteLevels: { 温蒂: 2, 未知干员: 2 },
    }),
    catalog,
  );
  const partialManufacture = manufactureResult(partial);
  assert.deepEqual(partial.warnings, [
    "队列 1：找不到干员“未知干员”的技能数据",
  ]);
  assert.ok(partialManufacture.production);

  const dailyOutput = calculateEfficiency(dailyOutputDocument(), catalog);
  assert.deepEqual(
    dailyOutput.dailyOutputs.map(({ kind, product }) => `${kind}:${product}`),
    [
      "production:合成玉",
      "production:赤金",
      "production:无人机",
      "production:信用",
      "production:公开招募标签刷新次数",
      "net:源石碎片",
    ],
  );
  const dailyClue = dailyOutput.dailyProductions.find(
    ({ product }) => product === "线索",
  );
  const dailyCredit = dailyOutput.dailyOutputs.find(
    ({ product }) => product === "信用",
  );
  assert.ok(dailyClue);
  assert.ok(dailyCredit);
  assert.ok(
    Math.abs(
      dailyCredit.amountPerDay -
        (40 +
          30 +
          20 +
          15 +
          10 +
          5 +
          210 +
          30 * 10 +
          300 / 7 +
          Math.floor(10 + 5000 / 125) +
          Math.floor(10 + 1000 / 125) +
          dailyClue.amountPerDay * 40),
    ) < 1e-9,
  );
  assert.ok(
    (dailyOutput.dailyOutputs.find(
      ({ kind, product }) => kind === "net" && product === "源石碎片",
    )?.amountPerDay ?? 0) < 0,
  );
  const signedMaterialResult = calculateEfficiency(
    documentFor({ trading: ["温蒂"], manufacture: ["砾"] }),
    catalog,
  );
  const signedManufacture = manufactureResult(signedMaterialResult);
  const signedTrading = signedMaterialResult.plans[0].facilities.find(
    ({ facility }) => facility.type === "trading",
  );
  assert.ok(signedManufacture.production);
  assert.ok(signedTrading?.production);
  assert.ok((signedManufacture.production?.amountPerHour ?? 0) > 0);
  assert.ok((signedTrading?.production?.materialPerHour?.["赤金"] ?? 0) < 0);

  const canonicalMaterial = calculateEfficiency(
    {
      layout: [
        { type: "control", level: 5 },
        { type: "trading", level: 3 },
        { type: "manufacture", level: 3 },
      ],
      plans: [
        {
          duration: 1440,
          rooms: {
            trading: [assignment(["可露希尔"], { 可露希尔: 2 })],
            manufacture: [
              { ...assignment(["砾"], { 砾: 2 }), product: "赤金" },
            ],
          },
        },
      ],
    },
    catalog,
  );
  const canonicalTrading = canonicalMaterial.plans[0].facilities.find(
    ({ facility }) => facility.type === "trading",
  );
  assert.equal(canonicalTrading?.production?.orders?.[0]?.material, "赤金");
  assert.ok(
    canonicalMaterial.dailyOutputs.some(({ product }) => product === "赤金"),
  );
  assert.ok(
    !canonicalMaterial.dailyOutputs.some(
      ({ product }) => product === "Pure Gold",
    ),
  );
  const providedFlowOutputs = aggregateDailyOutputs({ layout: [], plans: [] }, [
    {
      product: "赤金",
      amountPerHour: 23200 / 24,
      amountPerDay: 23200,
    },
    {
      product: "龙门币",
      amountPerHour: 0,
      amountPerDay: 0,
      materialPerHour: { 赤金: -24128.5956007 / 24 },
    },
  ]);
  assert.ok(
    Math.abs(
      (providedFlowOutputs.find(
        ({ kind, product }) => kind === "net" && product === "赤金",
      )?.amountPerDay ?? 0) + 928.5956007,
    ) < 1e-9,
  );

  const gladyBetaSplit = calculateEfficiency(
    abyssalDocument({
      manufacture: [["斯卡蒂", "幽灵鲨"], ["安哲拉"]],
    }),
    catalog,
  );
  const gladyBetaStations = gladyBetaSplit.plans[0].facilities.filter(
    ({ facility }) => facility.type === "manufacture",
  );
  assert.deepEqual(
    gladyBetaStations.map(
      (facility) =>
        facility.combinationDetails.find(
          ({ operator, skill }) =>
            operator === "歌蕾蒂娅" && skill === "集群狩猎·β",
        )?.value ?? 0,
    ),
    [60, 30],
  );

  const gladyAlphaSplit = calculateEfficiency(
    abyssalDocument({
      manufacture: [["斯卡蒂", "幽灵鲨", "安哲拉"], ["乌尔比安"]],
      eliteLevels: { 歌蕾蒂娅: 1 },
    }),
    catalog,
  );
  const gladyAlphaStations = gladyAlphaSplit.plans[0].facilities.filter(
    ({ facility }) => facility.type === "manufacture",
  );
  assert.deepEqual(
    gladyAlphaStations.map(
      (facility) =>
        facility.combinationDetails.find(
          ({ operator, skill }) =>
            operator === "歌蕾蒂娅" && skill === "集群狩猎·α",
        )?.value ?? 0,
    ),
    [45, 20],
  );

  const gladyZeroMoodHunter = calculateEfficiency(
    abyssalDocument({
      manufacture: [["斯卡蒂"], ["幽灵鲨"]],
      moods: { 幽灵鲨: 0 },
    }),
    catalog,
  );
  const gladyZeroMoodStations = gladyZeroMoodHunter.plans[0].facilities.filter(
    ({ facility }) => facility.type === "manufacture",
  );
  assert.equal(
    gladyZeroMoodStations[1]?.combinationDetails.find(
      ({ operator, skill }) =>
        operator === "歌蕾蒂娅" && skill === "集群狩猎·β",
    )?.value,
    20,
  );
  assert.ok(
    Math.abs(
      (gladyZeroMoodHunter.plans[0].moods.find(
        ({ operator }) => operator === "歌蕾蒂娅",
      )?.costRate ?? 0) - 2.4,
    ) < 1e-9,
  );

  const gladyAlone = calculateEfficiency(
    abyssalDocument({ manufacture: [[], []] }),
    catalog,
  );
  assert.ok(
    Math.abs(
      (gladyAlone.plans[0].moods.find(({ operator }) => operator === "歌蕾蒂娅")
        ?.costRate ?? 0) - 0.9,
    ) < 1e-9,
  );

  const gladyDormitoryHunter = calculateEfficiency(
    abyssalDocument({ manufacture: [[], []], dormitory: ["斯卡蒂"] }),
    catalog,
  );
  assert.ok(
    Math.abs(
      (gladyDormitoryHunter.plans[0].moods.find(
        ({ operator }) => operator === "歌蕾蒂娅",
      )?.costRate ?? 0) - 0.4,
    ) < 1e-9,
  );

  const huntingParty = calculateEfficiency(
    multipleTradingDocument({
      trading: [["焰狐龙梓兰"], ["雷狼龙S空爆", "罗德岛隐秘队"]],
    }),
    catalog,
  );
  const huntingStations = huntingParty.plans[0].facilities.filter(
    ({ facility }) => facility.type === "trading",
  );
  assert.equal(huntingStations[0]?.skillEfficiency, 60);
  assert.equal(huntingStations[1]?.skillEfficiency, 35);

  const demetrSplit = calculateEfficiency(
    multipleTradingDocument({
      trading: [["贝洛内"], ["伺夜"]],
    }),
    catalog,
  );
  const demetrSplitStation = demetrSplit.plans[0].facilities.filter(
    ({ facility }) => facility.type === "trading",
  )[0];
  assert.equal(demetrSplitStation?.attributes.orderLimit?.skill, 0);
  assert.equal(
    demetrSplit.plans[0].moods.find(({ operator }) => operator === "贝洛内")
      ?.costRate,
    1,
  );

  const demetrTogether = calculateEfficiency(
    multipleTradingDocument({
      trading: [["贝洛内", "伺夜"], []],
    }),
    catalog,
  );
  const demetrTogetherStation = demetrTogether.plans[0].facilities.filter(
    ({ facility }) => facility.type === "trading",
  )[0];
  assert.equal(demetrTogetherStation?.attributes.orderLimit?.skill, 2);
  assert.equal(
    demetrTogether.plans[0].moods.find(({ operator }) => operator === "贝洛内")
      ?.costRate,
    0.85,
  );

  const glasgowSplit = calculateEfficiency(
    multipleTradingDocument({
      trading: [["维娜·维多利亚"], ["推进之王"]],
    }),
    catalog,
  );
  const glasgowSplitStation = glasgowSplit.plans[0].facilities.filter(
    ({ facility }) => facility.type === "trading",
  )[0];
  assert.equal(glasgowSplitStation?.skillEfficiency, 30);

  const glasgowTogether = calculateEfficiency(
    multipleTradingDocument({
      trading: [["维娜·维多利亚", "推进之王"], []],
    }),
    catalog,
  );
  const glasgowTogetherStation = glasgowTogether.plans[0].facilities.filter(
    ({ facility }) => facility.type === "trading",
  )[0];
  assert.equal(glasgowTogetherStation?.skillEfficiency, 40);

  const hodrerProcessing = calculateEfficiency(
    tradingWithRoomDocument({
      trading: ["赫德雷"],
      room: "processing",
      roomOperators: ["伊内丝", "W"],
    }),
    catalog,
  );
  const hodrerProcessingStation = hodrerProcessing.plans[0].facilities.find(
    ({ facility }) => facility.type === "trading",
  );
  assert.equal(hodrerProcessingStation?.skillEfficiency, 40);

  const hodrerDormitory = calculateEfficiency(
    tradingWithRoomDocument({
      trading: ["赫德雷"],
      room: "dormitory",
      roomOperators: ["伊内丝", "W"],
    }),
    catalog,
  );
  const hodrerDormitoryStation = hodrerDormitory.plans[0].facilities.find(
    ({ facility }) => facility.type === "trading",
  );
  assert.equal(hodrerDormitoryStation?.skillEfficiency, 30);

  const wisdelTarget = calculateEfficiency(
    multipleTradingDocument({
      control: ["维什戴尔"],
      trading: [["赫德雷"], ["阿米娅"]],
    }),
    catalog,
  );
  const wisdelStations = wisdelTarget.plans[0].facilities.filter(
    ({ facility }) => facility.type === "trading",
  );
  assert.equal(wisdelStations[0]?.attributes.orderLimit?.skill, 2);
  assert.equal(wisdelStations[1]?.attributes.orderLimit?.skill ?? 0, 0);

  const wisdelDuplicateTargets = calculateEfficiency(
    multipleTradingDocument({
      control: ["维什戴尔"],
      trading: [["赫德雷"], ["赫德雷"]],
    }),
    catalog,
  );
  const duplicateTargetStations =
    wisdelDuplicateTargets.plans[0].facilities.filter(
      ({ facility }) => facility.type === "trading",
    );
  assert.equal(duplicateTargetStations[0]?.attributes.orderLimit?.skill, 2);
  assert.equal(duplicateTargetStations[1]?.attributes.orderLimit?.skill, 2);

  const overflowContinue = calculateEfficiency(
    documentFor({
      trading: ["温蒂"],
      manufacture: ["Lancet-2"],
      tradingProduct: "合成玉",
      duration: 2880,
    }),
    catalog,
  );
  const overflowZero = calculateEfficiency(
    documentFor({
      trading: ["温蒂"],
      manufacture: ["Lancet-2"],
      tradingProduct: "合成玉",
      duration: 2880,
      settings: { overflowMode: "zero" },
    }),
    catalog,
  );
  const continuedGold = overflowContinue.dailyOutputs.find(
    ({ kind, product }) => kind === "production" && product === "赤金",
  );
  const truncatedGold = overflowZero.dailyOutputs.find(
    ({ kind, product }) => kind === "production" && product === "赤金",
  );
  assert.ok(continuedGold);
  assert.ok(truncatedGold);
  assert.ok(truncatedGold.amountPerDay < continuedGold.amountPerDay);
  const continuedShard = overflowContinue.dailyOutputs.find(
    ({ kind, product }) => kind === "net" && product === "源石碎片",
  );
  const truncatedShard = overflowZero.dailyOutputs.find(
    ({ kind, product }) => kind === "net" && product === "源石碎片",
  );
  assert.ok(continuedShard);
  assert.ok(truncatedShard);
  assert.ok(
    Math.abs(truncatedShard.amountPerDay) <
      Math.abs(continuedShard.amountPerDay),
  );

  const wendy = calculateEfficiency(
    documentFor({
      control: ["薇薇安娜"],
      manufacture: ["温蒂", "砾"],
      eliteLevels: { 温蒂: 2, 砾: 1, 薇薇安娜: 2 },
    }),
    catalog,
  );
  const wendyManufacture = manufactureResult(wendy);
  assert.equal(wendyManufacture.moodEfficiency, 2);
  assert.equal(wendyManufacture.skillEfficiency, 45);
  assert.equal(wendyManufacture.operatorSkillEfficiency, 45);
  assert.equal(wendyManufacture.efficiency, 147);
  assertSkillDetails(wendyManufacture, ["温蒂"]);
  const percentageWendy = calculateEfficiency(
    documentFor({
      manufacture: ["温蒂", "35%"],
      eliteLevels: { 温蒂: 2 },
    }),
    catalog,
  );
  const percentageWendyManufacture = manufactureResult(percentageWendy);
  assert.equal(percentageWendyManufacture.skillEfficiency, 45);
  assertSkillDetails(percentageWendyManufacture, ["温蒂"]);
  const percentageHuaihu = calculateEfficiency(
    documentFor({
      manufacture: ["槐琥", "35%"],
      eliteLevels: { 槐琥: 2 },
    }),
    catalog,
  );
  const percentageHuaihuManufacture = manufactureResult(percentageHuaihu);
  assert.equal(percentageHuaihuManufacture.skillEfficiency, 70);
  const percentageTrading = calculateEfficiency(
    percentageFacilityDocument("trading", ["35%"]),
    catalog,
  );
  assert.equal(
    facilityResult(percentageTrading, "trading").skillEfficiency,
    35,
  );

  const percentagePower = calculateEfficiency(
    percentageFacilityDocument("power", ["20%"]),
    catalog,
  );
  assert.equal(facilityResult(percentagePower, "power").skillEfficiency, 20);

  const percentagePowerMultiple = calculateEfficiency(
    percentageFacilityDocument("power", ["20%", "20%", "20%"]),
    catalog,
  );
  const percentagePowerMultipleResult = facilityResult(
    percentagePowerMultiple,
    "power",
  );
  assert.equal(percentagePowerMultipleResult.skillEfficiency, 60);
  assert.equal(percentagePowerMultipleResult.efficiency, 175);

  const percentageMeeting = calculateEfficiency(
    percentageFacilityDocument("meeting", ["35%"]),
    catalog,
  );
  assert.equal(
    facilityResult(percentageMeeting, "meeting").combinationDetails.find(
      ({ operator, stat }) => operator === "35%" && stat === "clueSpeed",
    )?.value,
    35,
  );

  const percentageHire = calculateEfficiency(
    percentageFacilityDocument("hire", ["35%"]),
    catalog,
  );
  assert.equal(facilityResult(percentageHire, "hire").skillEfficiency, 35);

  const sleachZeroMood = calculateEfficiency(
    {
      layout: [
        { type: "control", level: 5 },
        { type: "hire", level: 3 },
      ],
      plans: [
        {
          duration: 720,
          rooms: {
            control: [assignment(["八幡海铃", "琴柳"], {})],
            hire: [assignment(["絮雨"], {}, { 絮雨: 0 })],
          },
        },
      ],
    },
    catalog,
  );
  const sleachZeroMoodHire = facilityResult(sleachZeroMood, "hire");
  assert.equal(sleachZeroMoodHire.efficiency, 130);
  assert.equal(sleachZeroMoodHire.baseEfficiency, 110);
  assert.equal(sleachZeroMoodHire.moodEfficiency, 0);
  assert.equal(
    sleachZeroMoodHire.combinationDetails.find(
      ({ operator, skill }) => operator === "琴柳" && skill === "感染力",
    )?.value,
    20,
  );

  const sleachAboveThreshold = calculateEfficiency(
    {
      layout: [
        { type: "control", level: 5 },
        { type: "hire", level: 3 },
      ],
      plans: [
        {
          duration: 720,
          rooms: {
            control: [assignment(["八幡海铃", "琴柳"], {})],
            hire: [assignment(["絮雨"], {}, { 絮雨: 24 })],
          },
        },
      ],
    },
    catalog,
  );
  const sleachAboveThresholdHire = facilityResult(sleachAboveThreshold, "hire");
  assert.equal(sleachAboveThresholdHire.efficiency, 135);
  assert.equal(
    sleachAboveThresholdHire.combinationDetails.some(
      ({ operator, skill }) => operator === "琴柳" && skill === "感染力",
    ),
    false,
  );

  const sleachAtThreshold = calculateEfficiency(
    {
      layout: [
        { type: "control", level: 5 },
        { type: "hire", level: 3 },
      ],
      plans: [
        {
          duration: 720,
          rooms: {
            control: [assignment(["灰烬", "琴柳"], {})],
            hire: [assignment(["闪击"], {})],
          },
        },
      ],
    },
    catalog,
  );
  const sleachAtThresholdHire = facilityResult(sleachAtThreshold, "hire");
  assert.equal(sleachAtThresholdHire.efficiency, 130);

  const totterStageOne = calculateEfficiency(
    documentFor({
      manufacture: ["铅踝"],
      eliteLevels: { 铅踝: 0 },
      moods: { 铅踝: 13.2 },
      duration: 720,
    }),
    catalog,
  );
  const totterStageOneManufacture = manufactureResult(totterStageOne);
  assert.ok(Math.abs(totterStageOneManufacture.skillEfficiency - 11.5) < 1e-9);
  assert.equal(totterStageOneManufacture.capacity?.total, 54);
  assert.equal(totterStageOneManufacture.capacity?.segments.length, 1);
  assert.ok(
    Math.abs((totterStageOne.plans[0].moods[0]?.end ?? 0) - 1.2) < 1e-9,
  );

  const totterStageTwo = calculateEfficiency(
    documentFor({
      manufacture: ["铅踝"],
      eliteLevels: { 铅踝: 1 },
      moods: { 铅踝: 13.2 },
      duration: 720,
    }),
    catalog,
  );
  const totterStageTwoManufacture = manufactureResult(totterStageTwo);
  assert.ok(Math.abs(totterStageTwoManufacture.skillEfficiency - 20.5) < 1e-9);
  assert.equal(totterStageTwoManufacture.capacity?.total, 60);
  assert.equal(totterStageTwoManufacture.capacity?.skill, 6);
  assert.equal(totterStageTwoManufacture.capacity?.segments.length, 2);

  const exhaustedTotter = calculateEfficiency(
    documentFor({
      manufacture: ["铅踝"],
      eliteLevels: { 铅踝: 0 },
      duration: 2880,
    }),
    catalog,
  );
  const exhaustedTotterManufacture = manufactureResult(exhaustedTotter);
  assert.equal(exhaustedTotter.plans[0].moods[0]?.end, 0);
  assert.ok(Math.abs(exhaustedTotterManufacture.skillEfficiency - 8.75) < 1e-9);

  const weightedTotter = calculateEfficiency(
    {
      layout: [{ type: "manufacture", level: 3 }],
      plans: [
        {
          duration: 360,
          rooms: {
            manufacture: [
              {
                ...assignment(["铅踝"], { 铅踝: 0 }, { 铅踝: 24 }),
                product: "赤金",
              },
            ],
          },
        },
        {
          duration: 720,
          rooms: {
            manufacture: [
              {
                ...assignment(["铅踝"], { 铅踝: 0 }, { 铅踝: 18 }),
                product: "赤金",
              },
            ],
          },
        },
      ],
    },
    catalog,
  );
  assert.ok(
    Math.abs(
      (weightedTotter.dailyFacilities[0]?.production?.amountPerHour ?? 0) -
        1.0175925925925926,
    ) < 1e-9,
  );

  const recoveryCatalog = catalogWithManufactureSkill(catalog, "恢复铅踝", [
    { target: "manufacture", stat: "moodRecover", value: 1.2 },
    { target: "manufacture", stat: "manuProd", value: 30 },
    {
      target: "manufacture",
      stat: "manuProd",
      baseValue: 2,
      per: { per: 4, value: -5, source: "moodDrop" },
    },
  ]);
  const recoveringTotter = calculateEfficiency(
    documentFor({
      manufacture: ["恢复铅踝"],
      moods: { 恢复铅踝: 18 },
      duration: 1200,
    }),
    recoveryCatalog,
  );
  const recoveringTotterManufacture = manufactureResult(recoveringTotter);
  assert.ok(
    Math.abs((recoveringTotter.plans[0].moods[0]?.costRate ?? 0) + 0.2) < 1e-9,
  );
  assert.ok(
    Math.abs((recoveringTotter.plans[0].moods[0]?.end ?? 0) - 22) < 1e-9,
  );
  assert.ok(
    Math.abs(recoveringTotterManufacture.skillEfficiency - 29.5) < 1e-9,
  );

  const statCatalog = catalogWithManufactureSkill(
    catalogWithManufactureSkill(catalog, "固定值统计测试员", [
      {
        target: "manufacture",
        stat: "manuProd",
        baseValue: 5,
        per: { per: 10, value: 1, source: "stat", stat: "manuProd" },
      },
    ]),
    "统计曲线测试员",
    [
      {
        target: "manufacture",
        stat: "manuProd",
        curve: {
          type: "ramp",
          startValue: 10,
          startHours: 0,
          step: 1,
          cap: 30,
        },
      },
    ],
  );
  const segmentedStatResult = calculateEfficiency(
    documentFor({
      manufacture: ["固定值统计测试员", "统计曲线测试员"],
      duration: 720,
    }),
    statCatalog,
  );
  const segmentedStatDetail = manufactureResult(
    segmentedStatResult,
  ).details.find(({ operator }) => operator === "固定值统计测试员");
  assert.deepEqual(
    segmentedStatDetail?.calculation?.steps?.map(({ value }) => value),
    [6, 7],
  );

  const capacityCatalog = catalogWithManufactureSkill(
    catalog,
    "容量恢复测试员",
    [
      { target: "manufacture", stat: "moodRecover", value: 1.1 },
      { target: "manufacture", stat: "manuProd", value: 75 },
      {
        target: "manufacture",
        stat: "storageCap",
        value: 6,
        condition: { type: "moodDrop", value: 12 },
      },
    ],
  );
  const capacityRecovery = calculateEfficiency(
    documentFor({
      manufacture: ["容量恢复测试员"],
      moods: { 容量恢复测试员: 10 },
      duration: 1200,
    }),
    capacityCatalog,
  );
  const capacityRecoveryManufacture = manufactureResult(capacityRecovery);
  assert.ok(
    Math.abs((capacityRecovery.plans[0].moods[0]?.costRate ?? 0) + 0.1) < 1e-9,
  );
  assert.equal(capacityRecoveryManufacture.capacity?.total, 54);
  assert.equal(capacityRecoveryManufacture.capacity?.segments[0]?.total, 60);
  assert.equal(capacityRecoveryManufacture.production?.overflowed, true);
  assert.equal(capacityRecoveryManufacture.production?.breachTime, 20);

  const capacityPerBaseName = "分段容量效率测试员";
  const capacityPerBaseCatalog = catalogWithManufactureSkill(
    catalog,
    capacityPerBaseName,
    [
      {
        target: "manufacture",
        stat: "manuProd",
        baseValue: 5,
        per: { per: 1, value: 1, source: "facCap", stat: "storageCap" },
      },
    ],
  );
  const capacityPerNoBaseCatalog = catalogWithManufactureSkill(
    catalog,
    capacityPerBaseName,
    [
      {
        target: "manufacture",
        stat: "manuProd",
        per: { per: 1, value: 1, source: "facCap", stat: "storageCap" },
      },
    ],
  );
  const capacityPerSchedule = documentFor({
    manufacture: ["红云", "铅踝", capacityPerBaseName],
    eliteLevels: { 红云: 1, 铅踝: 1 },
    moods: { 铅踝: 13.2 },
    duration: 720,
  });
  const segmentedCapacityWithBase = calculateEfficiency(
    capacityPerSchedule,
    capacityPerBaseCatalog,
  );
  const segmentedCapacityWithoutBase = calculateEfficiency(
    capacityPerSchedule,
    capacityPerNoBaseCatalog,
  );
  const capacityWithBaseFacility = manufactureResult(segmentedCapacityWithBase);
  const capacityWithoutBaseFacility = manufactureResult(
    segmentedCapacityWithoutBase,
  );
  const capacityWithBaseValue = capacityWithBaseFacility.details.find(
    ({ operator }) => operator === capacityPerBaseName,
  )?.value;
  const capacityWithoutBaseValue = capacityWithoutBaseFacility.details.find(
    ({ operator }) => operator === capacityPerBaseName,
  )?.value;
  assert.ok((capacityWithBaseFacility.capacity?.segments.length ?? 0) > 1);
  assert.ok(
    Math.abs(
      (capacityWithBaseValue ?? 0) - (capacityWithoutBaseValue ?? 0) - 5,
    ) < 1e-9,
  );

  const redCloudCapacity = calculateEfficiency(
    documentFor({
      manufacture: ["红云", "铅踝"],
      eliteLevels: { 红云: 1, 铅踝: 1 },
      moods: { 铅踝: 13.2 },
      duration: 720,
    }),
    catalog,
  );
  const redCloudCapacityManufacture = manufactureResult(redCloudCapacity);
  assert.equal(redCloudCapacityManufacture.capacity?.total, 68);
  assert.equal(redCloudCapacityManufacture.capacity?.segments.length, 2);
  assert.equal(
    redCloudCapacityManufacture.capacity?.segments[0]?.startHours,
    0,
  );
  assert.ok(
    Math.abs(
      (redCloudCapacityManufacture.capacity?.segments[0]?.endHours ?? 0) -
        1.263157894736842,
    ) < 1e-9,
  );
  assert.equal(redCloudCapacityManufacture.capacity?.segments[0]?.total, 62);
  assert.ok(
    Math.abs(
      (redCloudCapacityManufacture.capacity?.segments[1]?.startHours ?? 0) -
        1.263157894736842,
    ) < 1e-9,
  );
  assert.equal(redCloudCapacityManufacture.capacity?.segments[1]?.endHours, 12);
  assert.equal(redCloudCapacityManufacture.capacity?.segments[1]?.total, 68);
  const bubbleCapacity = calculateEfficiency(
    documentFor({
      manufacture: ["泡泡", "红云", "铅踝"],
      eliteLevels: { 泡泡: 1, 红云: 1, 铅踝: 1 },
      moods: { 铅踝: 13.2 },
      duration: 720,
    }),
    catalog,
  );
  const bubbleCapacityManufacture = manufactureResult(bubbleCapacity);
  assert.equal(bubbleCapacityManufacture.capacity?.total, 78);
  const directPreviousQueueMood = calculateEfficiency(
    {
      layout: [{ type: "manufacture", level: 3 }],
      plans: [
        {
          duration: 720,
          rooms: {
            manufacture: [assignmentWithoutMood(["铅踝"])],
          },
        },
        {
          duration: 720,
          rooms: {
            manufacture: [assignmentWithoutMood([])],
          },
        },
        {
          duration: 720,
          rooms: {
            manufacture: [assignment(["铅踝"], { 铅踝: 0 }, { 铅踝: 18 })],
          },
        },
      ],
    },
    catalog,
  );
  assert.deepEqual(
    directPreviousQueueMood.plans.map((plan) => plan.moods[0]?.start),
    [6, undefined, 18],
  );

  const missingPreviousQueueMood = calculateEfficiency(
    {
      layout: [{ type: "manufacture", level: 3 }],
      plans: [
        {
          duration: 720,
          rooms: {
            manufacture: [
              {
                operators: ["铅踝"],
                operatorStates: { 铅踝: { elite: 0, level: 1 } },
              },
            ],
          },
        },
        {
          duration: 720,
          rooms: {
            manufacture: [assignmentWithoutMood([])],
          },
        },
        {
          duration: 720,
          rooms: {
            manufacture: [
              {
                operators: ["铅踝"],
                operatorStates: { 铅踝: { elite: 0, level: 1 } },
              },
            ],
          },
        },
      ],
    },
    catalog,
  );
  assert.deepEqual(
    missingPreviousQueueMood.plans.map((plan) => plan.moods[0]?.start),
    [12, undefined, 24],
  );
  assert.deepEqual(
    missingPreviousQueueMood.plans.map((plan) => plan.moods[0]?.end),
    [0, undefined, 12],
  );

  const steadyRecovery = calculateEfficiency(
    {
      layout: [{ type: "manufacture", level: 3 }],
      plans: [
        {
          duration: 600,
          rooms: {
            manufacture: [assignmentWithoutMood(["恢复铅踝"])],
          },
        },
        {
          duration: 600,
          rooms: {
            manufacture: [assignmentWithoutMood(["恢复铅踝"])],
          },
        },
      ],
    },
    recoveryCatalog,
  );
  assert.deepEqual(
    steadyRecovery.plans.map((plan) => plan.moods[0]?.start),
    [24, 24],
  );
  assert.deepEqual(
    steadyRecovery.plans.map((plan) => plan.moods[0]?.end),
    [24, 24],
  );

  const fiammettaSteadyMood = calculateEfficiency(
    fiammettaDocument({
      mode: "queue",
      fiammetta: {
        queue: [
          { operators: ["雷狼龙S空爆"] },
          {},
          { operators: ["雷狼龙S空爆"] },
        ],
      },
      plans: [0, 1, 2].map(() => ({
        duration: 720,
        rooms: {
          trading: [assignmentWithoutMoodAtElite(["雷狼龙S空爆"])],
          dormitory: [fiammettaAssignment(["菲亚梅塔"])],
        },
      })),
    }),
    catalog,
  );
  const fiammettaSteadyMoodPlan = fiammettaSteadyMood.plans[1];
  const fiammettaSteadyMoodSnapshot = fiammettaSteadyMoodPlan.moods.find(
    ({ operator }) => operator === "雷狼龙S空爆",
  );
  const fiammettaSteadyMoodTrading = fiammettaSteadyMoodPlan.facilities.find(
    ({ facility }) => facility.type === "trading",
  );
  assert.equal(fiammettaSteadyMoodSnapshot?.start, 12);
  assert.equal(fiammettaSteadyMoodSnapshot?.end, 0);
  assert.equal(fiammettaSteadyMoodSnapshot?.working, true);
  assert.equal(fiammettaSteadyMoodTrading?.skillEfficiency, 35);
  assert.equal(fiammettaSteadyMoodTrading?.efficiency, 136);

  const huaihu = calculateEfficiency(
    documentFor({
      manufacture: ["槐琥", "砾"],
      eliteLevels: { 槐琥: 2, 砾: 1 },
    }),
    catalog,
  );
  const huaihuManufacture = manufactureResult(huaihu);
  assert.equal(huaihuManufacture.skillEfficiency, 70);
  assert.equal(huaihuManufacture.operatorSkillEfficiency, 70);
  const huaihuCrossFacility = calculateEfficiency(
    {
      layout: [
        { type: "control", level: 5 },
        { type: "manufacture", level: 3 },
        { type: "manufacture", level: 3 },
        { type: "power", level: 3 },
      ],
      plans: [
        {
          duration: 720,
          rooms: {
            control: [assignment([], {})],
            manufacture: [
              {
                ...assignment(["槐琥", "野鬃"], {
                  槐琥: 2,
                  野鬃: 2,
                }),
                product: "赤金",
              },
              { product: "赤金" },
            ],
            power: [
              {
                ...assignment(["正义骑士号"], {}),
                operatorStates: {
                  正义骑士号: { elite: 0, level: 30, mood: 24 },
                },
              },
            ],
          },
        },
      ],
    },
    catalog,
    { treatSkillsAsUnlocked: true },
  );
  const huaihuCrossFacilityManufacture = manufactureResult(huaihuCrossFacility);
  assert.equal(huaihuCrossFacilityManufacture.skillEfficiency, 55);
  const snowWithGnosis = calculateEfficiency(
    documentFor({
      control: ["灵知"],
      trading: ["雪雉", "初雪", "耶拉"],
      eliteLevels: { 灵知: 2, 雪雉: 0, 初雪: 2, 耶拉: 2 },
    }),
    catalog,
  );
  const snowWithGnosisTrading = tradingResult(snowWithGnosis);
  assert.equal(snowWithGnosisTrading.skillEfficiency, -60);
  assert.equal(snowWithGnosisTrading.efficiency, 43);
  assert.equal(
    snowWithGnosisTrading.combinationDetails.find(
      ({ operator, skill }) => operator === "雪雉" && skill === "天道酬勤·α",
    )?.value,
    -30,
  );

  const snowWithMorig = calculateEfficiency(
    documentFor({
      control: ["八幡海铃"],
      trading: ["雪雉", "拉普兰德"],
      eliteLevels: { 八幡海铃: 2, 雪雉: 0, 拉普兰德: 2 },
    }),
    catalog,
  );
  const snowWithMorigTrading = tradingResult(snowWithMorig);
  assert.equal(snowWithMorigTrading.skillEfficiency, 10);
  const snowWithFacilitySkills = calculateEfficiency(
    documentFor({
      control: ["阿米娅", "诗怀雅"],
      trading: ["雪雉"],
      eliteLevels: { 阿米娅: 0, 诗怀雅: 0, 雪雉: 0 },
    }),
    catalog,
  );
  const snowWithFacilitySkillsTrading = tradingResult(snowWithFacilitySkills);
  assert.equal(snowWithFacilitySkillsTrading.baseEfficiency, 107);
  assert.equal(snowWithFacilitySkillsTrading.skillEfficiency, 0);
  assert.equal(snowWithFacilitySkillsTrading.efficiency, 108);

  const snowWithSwire = calculateEfficiency(
    documentFor({
      control: ["灵知"],
      trading: ["雪雉", "琳琅诗怀雅", "银灰"],
      eliteLevels: { 灵知: 2, 雪雉: 2, 琳琅诗怀雅: 2, 银灰: 0 },
    }),
    catalog,
  );
  const snowWithSwireTrading = tradingResult(snowWithSwire);
  assert.equal(snowWithSwireTrading.skillEfficiency, 87);
  assert.equal(
    snowWithSwireTrading.combinationDetails.find(
      ({ operator, stat }) =>
        operator === "琳琅诗怀雅" && stat === "tradeNetEff",
    )?.value,
    32,
  );
  const snowWithJieGap = calculateEfficiency(
    documentFor({
      trading: ["雪雉", "孑"],
      eliteLevels: { 雪雉: 0, 孑: 0 },
    }),
    catalog,
  );
  const snowWithJieGapTrading = tradingResult(snowWithJieGap);
  assert.equal(
    snowWithJieGapTrading.combinationDetails.some(
      ({ operator, stat }) => operator === "雪雉" && stat === "tradeSpd",
    ),
    false,
  );

  const suppressed = calculateEfficiency(
    documentFor({
      manufacture: ["红云", "泡泡"],
      eliteLevels: { 红云: 2, 泡泡: 2 },
    }),
    catalog,
  );
  const suppressedManufacture = manufactureResult(suppressed);
  assert.equal(suppressedManufacture.attributes.storageCap?.total, 72);
  assert.equal(suppressedManufacture.skillEfficiency, 18);
  assertSkillDetails(suppressedManufacture, ["泡泡"]);

  const seafoam = calculateEfficiency(
    documentFor({
      manufacture: ["海沫", "多萝西", "水月"],
      eliteLevels: { 海沫: 0, 多萝西: 2, 水月: 0 },
    }),
    catalog,
  );
  const seafoamManufacture = manufactureResult(seafoam);
  assert.equal(seafoamManufacture.skillEfficiency, 35);
  assert.equal(
    seafoamManufacture.combinationDetails.find(
      ({ operator, skill }) => operator === "水月" && skill === "意识协议",
    )?.value,
    5,
  );

  const huaihuMood = calculateEfficiency(
    documentFor({
      manufacture: ["槐琥", "泡普卡"],
      eliteLevels: { 槐琥: 2, 泡普卡: 0 },
    }),
    catalog,
  );
  const huaihuMoodSnapshots = huaihuMood.plans[0].moods.filter(
    ({ facility }) => facility === "manufacture",
  );
  assert.equal(
    huaihuMoodSnapshots.find(({ operator }) => operator === "槐琥")?.costRate,
    0.95,
  );
  assert.equal(
    huaihuMoodSnapshots.find(({ operator }) => operator === "泡普卡")?.costRate,
    0.95,
  );

  const clearedDerived = calculateEfficiency(
    documentFor({
      manufacture: ["温蒂", "槐琥", "砾"],
      eliteLevels: { 温蒂: 2, 槐琥: 2, 砾: 1 },
    }),
    catalog,
  );
  const clearedDerivedManufacture = manufactureResult(clearedDerived);
  assert.equal(clearedDerivedManufacture.moodEfficiency, 3);
  assert.equal(clearedDerivedManufacture.skillEfficiency, 45);
  assert.equal(clearedDerivedManufacture.operatorSkillEfficiency, 45);
  assertSkillDetails(clearedDerivedManufacture, ["温蒂"]);
  const mutual = calculateEfficiency(
    documentFor({
      manufacture: ["温蒂", "冬时"],
      eliteLevels: { 温蒂: 2, 冬时: 1 },
    }),
    catalog,
  );
  const mutualManufacture = manufactureResult(mutual);
  assert.equal(mutualManufacture.skillEfficiency, 65);
  assert.equal(mutualManufacture.operatorSkillEfficiency, 65);
  const facilitySkill = calculateEfficiency(
    documentFor({
      control: ["斩业星熊", "诗怀雅"],
      manufacture: ["温蒂"],
      eliteLevels: { 斩业星熊: 2, 诗怀雅: 2, 温蒂: 2 },
    }),
    catalog,
  );
  const facilitySkillManufacture = manufactureResult(facilitySkill);
  assert.equal(facilitySkillManufacture.baseEfficiency, 103);
  assert.equal(facilitySkillManufacture.skillEfficiency, 45);
  assert.equal(facilitySkillManufacture.operatorSkillEfficiency, 45);
  assertSkillDetails(facilitySkillManufacture, ["温蒂"]);

  const clearedGoldSkill = calculateEfficiency(
    documentFor({
      control: ["丰川祥子"],
      manufacture: ["温蒂"],
      eliteLevels: { 丰川祥子: 2, 温蒂: 2 },
    }),
    catalog,
  );
  const clearedGoldManufacture = manufactureResult(clearedGoldSkill);
  assert.equal(clearedGoldManufacture.baseEfficiency, 100);
  assert.equal(clearedGoldManufacture.skillEfficiency, 45);
  assert.equal(clearedGoldManufacture.operatorSkillEfficiency, 45);
  assertSkillDetails(clearedGoldManufacture, ["温蒂"]);

  const facilityCountSkills = calculateEfficiency(
    documentFor({
      manufacture: ["温蒂", "清流", "引星棘刺"],
      eliteLevels: { 温蒂: 2, 清流: 1, 引星棘刺: 2 },
    }),
    catalog,
  );
  const facilityCountManufacture = manufactureResult(facilityCountSkills);
  assert.equal(facilityCountManufacture.skillEfficiency, 68);
  assert.equal(facilityCountManufacture.operatorSkillEfficiency, 68);
  assert.equal(facilityCountManufacture.efficiency, 171);
  assertSkillDetails(facilityCountManufacture, ["温蒂", "清流", "引星棘刺"]);

  const trade = calculateEfficiency(
    documentFor({
      trading: ["巫恋", "琳琅诗怀雅"],
      eliteLevels: { 巫恋: 2, 琳琅诗怀雅: 2 },
    }),
    catalog,
  );
  const tradeFacility = tradingResult(trade);
  assert.equal(tradeFacility.skillEfficiency, 45);
  assert.equal(tradeFacility.operatorSkillEfficiency, 45);
  assertSkillDetails(tradeFacility, ["巫恋"]);

  const danshuAlpha = calculateEfficiency(
    documentFor({
      trading: ["但书"],
      eliteLevels: { 但书: 0 },
    }),
    catalog,
  );
  assert.deepEqual(
    tradingResult(danshuAlpha).production?.orders?.map(
      ({ name, quantity, amount }) => ({
        name,
        quantity,
        amount,
      }),
    ),
    [
      { name: "2贵金属订单", quantity: 1500, amount: 3 },
      { name: "3贵金属订单", quantity: 2000, amount: 4 },
      { name: "4贵金属订单", quantity: 2000, amount: 4 },
    ],
  );

  const danshuBeta = calculateEfficiency(
    documentFor({
      trading: ["但书"],
      eliteLevels: { 但书: 2 },
    }),
    catalog,
  );
  assert.deepEqual(
    tradingResult(danshuBeta).production?.orders?.map(
      ({ name, quantity, amount }) => ({
        name,
        quantity,
        amount,
      }),
    ),
    [
      { name: "2贵金属订单", quantity: 2000, amount: 4 },
      { name: "3贵金属订单", quantity: 2500, amount: 5 },
      { name: "4贵金属订单", quantity: 2000, amount: 4 },
    ],
  );

  const jieMax = calculateEfficiency(
    documentFor({
      trading: ["孑"],
      eliteLevels: { 孑: 0 },
      settings: { preferMaxJieEfficiency: true },
    }),
    catalog,
  );
  const jieMaxFacility = tradingResult(jieMax);
  const jieMaxDetail = jieMaxFacility.combinationDetails.find(
    ({ stat }) => stat === "tradeGapEff",
  );
  assert.equal(jieMaxFacility.efficiency, 141);
  assert.equal(jieMaxDetail?.value, 40);
  assert.equal(jieMaxDetail?.calculation?.type, "tradeGap");
  assert.equal(jieMaxDetail?.calculation?.mode, "max");

  const jieIntegral = calculateEfficiency(
    documentFor({
      trading: ["孑"],
      eliteLevels: { 孑: 0 },
      settings: { preferMaxJieEfficiency: false },
    }),
    catalog,
  );
  const jieIntegralFacility = tradingResult(jieIntegral);
  const jieIntegralDetail = jieIntegralFacility.combinationDetails.find(
    ({ stat }) => stat === "tradeGapEff",
  );
  assert.ok(jieIntegralDetail);
  assert.equal(jieIntegralDetail.calculation?.type, "tradeGap");
  assert.equal(jieIntegralDetail.calculation?.mode, "integral");
  assert.ok(jieIntegralDetail.value < jieMaxDetail.value);
  assert.ok((jieIntegralDetail.calculation?.completedOrders ?? 0) > 0);

  const jieProgress = calculateEfficiency(
    documentFor({
      trading: ["孑"],
      eliteLevels: { 孑: 0 },
      settings: { preferMaxJieEfficiency: false, firstItemProgress: 0.5 },
    }),
    catalog,
  );
  const jieProgressDetail = tradingResult(jieProgress).combinationDetails.find(
    ({ stat }) => stat === "tradeGapEff",
  );
  assert.ok(jieProgressDetail);
  assert.ok(jieProgressDetail.value < jieIntegralDetail.value);

  const jieFixedOrder = calculateEfficiency(
    documentFor({
      trading: ["孑", "佩佩"],
      eliteLevels: { 孑: 0, 佩佩: 2 },
      settings: { preferMaxJieEfficiency: false },
    }),
    catalog,
  );
  const jieFixedOrderDetail = tradingResult(
    jieFixedOrder,
  ).combinationDetails.find(({ stat }) => stat === "tradeGapEff");
  assert.equal(jieFixedOrderDetail?.calculation?.mode, "max");
  assert.equal(jieFixedOrderDetail?.calculation?.fallbackReason, "fixedOrder");

  const jieUnlocked = calculateEfficiency(
    {
      layout: [
        { type: "control", level: 5 },
        { type: "trading", level: 3 },
      ],
      plans: [
        {
          duration: 720,
          rooms: { control: [{}], trading: [{ operators: ["孑"] }] },
        },
      ],
    },
    catalog,
    { treatSkillsAsUnlocked: true },
  );
  assert.equal(tradingResult(jieUnlocked).efficiency, 141);

  const jieManualElite = calculateEfficiency(
    documentFor({
      trading: ["孑"],
      eliteLevels: { 孑: 1 },
      settings: { preferMaxJieEfficiency: true },
    }),
    catalog,
    { treatSkillsAsUnlocked: true },
  );
  const jieManualEliteFacility = tradingResult(jieManualElite);
  const jieManualEliteCountDetail =
    jieManualEliteFacility.combinationDetails.find(
      ({ operator, stat }) => operator === "孑" && stat === "tradeSpd",
    );
  const jieManualEliteGapDetail =
    jieManualEliteFacility.combinationDetails.find(
      ({ operator, stat }) => operator === "孑" && stat === "tradeGapEff",
    );
  assert.equal(jieManualEliteFacility.skillEfficiency, 40);
  assert.equal(jieManualEliteFacility.efficiency, 141);
  assert.equal(jieManualEliteFacility.attributes.orderLimit?.skill, 0);
  assert.equal(jieManualEliteFacility.attributes.orderLimit?.total, 10);
  assert.equal(jieManualEliteCountDetail?.value, 40);
  assert.equal(jieManualEliteGapDetail?.value, 0);

  const jieEliteIntegral = calculateEfficiency(
    documentFor({
      trading: ["孑"],
      eliteLevels: { 孑: 1 },
      settings: { preferMaxJieEfficiency: false },
    }),
    catalog,
    { treatSkillsAsUnlocked: true },
  );
  const jieEliteIntegralFacility = tradingResult(jieEliteIntegral);
  const jieEliteIntegralGapDetail =
    jieEliteIntegralFacility.combinationDetails.find(
      ({ operator, stat }) => operator === "孑" && stat === "tradeGapEff",
    );
  assert.equal(jieEliteIntegralFacility.efficiency, 141);
  assert.equal(jieEliteIntegralGapDetail?.value, 0);
  assert.equal(jieEliteIntegralGapDetail?.calculation?.mode, "integral");
  assert.equal(jieEliteIntegralGapDetail?.calculation?.decrement, 0);

  const jieOrderLimitCases = [
    { elite: 0, expectedSkill: -2, expectedTotal: 8 },
    { elite: 1, expectedSkill: -6, expectedTotal: 4 },
  ];
  jieOrderLimitCases.forEach(({ elite, expectedSkill, expectedTotal }) => {
    const result = calculateEfficiency(
      documentFor({
        trading: ["孑", "银灰", "锏"],
        eliteLevels: { 孑: elite, 银灰: 2, 锏: 2 },
        settings: { preferMaxJieEfficiency: true },
      }),
      catalog,
      { treatSkillsAsUnlocked: true },
    );
    const facility = tradingResult(result);
    assert.equal(facility.attributes.orderLimit?.skill, expectedSkill);
    assert.equal(facility.attributes.orderLimit?.total, expectedTotal);
  });

  const jieMaxWorkbookCases = [
    {
      name: "银灰Ⅱ+琳琅诗怀雅Ⅱ+灵知Ⅱ（中枢）",
      trading: ["孑", "银灰", "琳琅诗怀雅"],
      control: ["灵知"],
      eliteLevels: { 孑: 0, 银灰: 2, 琳琅诗怀雅: 2, 灵知: 2 },
      expected: 145,
    },
    {
      name: "银灰Ⅱ+锏Ⅱ+灵知Ⅱ（中枢）",
      trading: ["孑", "银灰", "锏"],
      control: ["灵知"],
      eliteLevels: { 孑: 0, 银灰: 2, 锏: 2, 灵知: 2 },
      expected: 145,
    },
    {
      name: "银灰Ⅱ+灵知Ⅱ（中枢）",
      trading: ["孑", "银灰"],
      control: ["灵知"],
      eliteLevels: { 孑: 0, 银灰: 2, 灵知: 2 },
      expected: 85,
    },
    {
      name: "银灰Ⅱ",
      trading: ["孑", "银灰"],
      eliteLevels: { 孑: 0, 银灰: 2 },
      expected: 76,
    },
    {
      name: "崖心Ⅱ+灵知Ⅱ（中枢）",
      trading: ["孑", "崖心"],
      control: ["灵知"],
      eliteLevels: { 孑: 0, 崖心: 2, 灵知: 2 },
      expected: 80,
    },
    {
      name: "角峰Ⅱ+灵知Ⅱ（中枢）",
      trading: ["孑", "角峰"],
      control: ["灵知"],
      eliteLevels: { 孑: 0, 角峰: 2, 灵知: 2 },
      expected: 72,
    },
    {
      name: "崖心Ⅱ",
      trading: ["孑", "崖心"],
      eliteLevels: { 孑: 0, 崖心: 2 },
      expected: 71,
    },
    {
      name: "角峰Ⅱ",
      trading: ["孑", "角峰"],
      eliteLevels: { 孑: 0, 角峰: 2 },
      expected: 63,
    },
  ];
  jieMaxWorkbookCases.forEach(
    ({ name, trading, control = [], eliteLevels, expected }) => {
      const result = calculateEfficiency(
        documentFor({
          trading,
          control,
          eliteLevels,
          settings: { preferMaxJieEfficiency: true },
        }),
        catalog,
        { treatSkillsAsUnlocked: true },
      );
      assert.equal(tradingResult(result).skillEfficiency, expected, name);
    },
  );

  const jieWorkbookCases = [
    {
      name: "银灰Ⅱ+灵知Ⅱ（中枢）",
      trading: ["孑", "银灰"],
      control: ["灵知"],
      eliteLevels: { 孑: 1, 银灰: 2, 灵知: 2 },
      expected: 85,
    },
    {
      name: "银灰Ⅱ+琳琅诗怀雅Ⅱ+灵知Ⅱ（中枢）",
      trading: ["孑", "银灰", "琳琅诗怀雅"],
      control: ["灵知"],
      eliteLevels: { 孑: 1, 银灰: 2, 琳琅诗怀雅: 2, 灵知: 2 },
      expected: 129,
    },
    {
      name: "银灰Ⅱ+锏Ⅱ+灵知Ⅱ（中枢）",
      trading: ["孑", "银灰", "锏"],
      control: ["灵知"],
      eliteLevels: { 孑: 1, 银灰: 2, 锏: 2, 灵知: 2 },
      expected: 121,
    },
    {
      name: "银灰Ⅱ",
      trading: ["孑", "银灰"],
      eliteLevels: { 孑: 1, 银灰: 2 },
      expected: 68,
    },
    {
      name: "崖心Ⅱ",
      trading: ["孑", "崖心"],
      eliteLevels: { 孑: 1, 崖心: 2 },
      expected: 67,
    },
    {
      name: "角峰Ⅱ",
      trading: ["孑", "角峰"],
      eliteLevels: { 孑: 1, 角峰: 2 },
      expected: 59,
    },
    {
      name: "讯使Ⅱ",
      trading: ["孑", "讯使"],
      eliteLevels: { 孑: 1, 讯使: 2 },
      expected: 59,
    },
  ];
  jieWorkbookCases.forEach(
    ({ name, trading, control = [], eliteLevels, expected }) => {
      const result = calculateEfficiency(
        documentFor({ trading, control, eliteLevels }),
        catalog,
        { treatSkillsAsUnlocked: true },
      );
      assert.equal(tradingResult(result).skillEfficiency, expected, name);
    },
  );

  const hiddenFlowGold = calculateEfficiency(
    flowGoldDocument({ manufactureCount: 1 }),
    catalog,
  );
  assert.equal(hiddenFlowGold.plans[0].basePoints["cc.t.flow_gold"], 1);
  assert.equal(
    hiddenFlowGold.plans[0].basePointDetails.some(
      ({ term }) => term === "cc.t.flow_gold",
    ),
    false,
  );

  const flowGold = calculateEfficiency(
    flowGoldDocument({
      trading: ["绮良", "鸿雪", "图耶"],
      control: ["至简"],
      manufactureCount: 2,
      eliteLevels: { 绮良: 2, 鸿雪: 2, 图耶: 2, 至简: 2 },
    }),
    catalog,
  );
  const flowGoldTrading = tradingResult(flowGold);
  assert.equal(flowGold.plans[0].basePoints["cc.t.flow_gold"], 5);
  assert.equal(
    flowGold.plans[0].basePointDetails.find(
      ({ term }) => term === "cc.t.flow_gold",
    )?.value,
    5,
  );
  assert.equal(flowGoldTrading.skillEfficiency, 65);
  assert.equal(
    flowGoldTrading.combinationDetails.find(
      ({ operator, skill }) => operator === "鸿雪" && skill === "销路宣发",
    )?.value,
    25,
  );
  assert.equal(
    flowGoldTrading.combinationDetails.find(
      ({ operator, skill }) => operator === "图耶" && skill === "物流规划·β",
    )?.value,
    30,
  );
  assert.equal(
    flowGoldTrading.combinationDetails.find(
      ({ operator, skill }) =>
        operator === "绮良" && skill === "订单流可视化·β",
    )?.value,
    5,
  );

  const exhaustedFlowGold = calculateEfficiency(
    flowGoldDocument({
      trading: ["绮良"],
      moods: { 绮良: 0 },
      eliteLevels: { 绮良: 2 },
    }),
    catalog,
  );
  assert.equal(
    exhaustedFlowGold.plans[0].basePointDetails.some(
      ({ term }) => term === "cc.t.flow_gold",
    ),
    true,
  );

  const queueFiammetta = calculateEfficiency(
    fiammettaDocument({
      mode: "queue",
      fiammetta: {
        queue: [{ operators: ["德克萨斯"] }, {}, { operators: ["德克萨斯"] }],
      },
      plans: [
        {
          duration: 60,
          rooms: {
            trading: [fiammettaAssignment(["德克萨斯"])],
            dormitory: [{}],
          },
        },
        {
          duration: 60,
          rooms: {
            trading: [fiammettaAssignment(["德克萨斯"])],
            dormitory: [fiammettaAssignment(["菲亚梅塔"])],
          },
        },
        {
          duration: 60,
          rooms: {
            trading: [fiammettaAssignment(["德克萨斯"])],
            dormitory: [{}],
          },
        },
      ],
    }),
    catalog,
  );
  assert.equal(
    queueFiammetta.plans[0].moods.find(
      ({ operator }) => operator === "德克萨斯",
    ).start,
    24,
  );
  assert.deepEqual(queueFiammetta.fiammettaWarnings, []);
  assert.equal(queueFiammetta.fiammetta.plans[1].recoverRate, 2);

  const delayedQueueFiammetta = calculateEfficiency(
    fiammettaDocument({
      mode: "queue",
      fiammetta: {
        queue: [{ operators: ["德克萨斯"] }, {}, { operators: ["德克萨斯"] }],
      },
      plans: [
        {
          duration: 60,
          rooms: {
            trading: [fiammettaAssignment(["德克萨斯"])],
            dormitory: [{}],
          },
        },
        {
          duration: 60,
          rooms: {
            trading: [fiammettaAssignment(["德克萨斯"])],
            dormitory: [{}],
          },
        },
        {
          duration: 60,
          rooms: {
            trading: [fiammettaAssignment(["德克萨斯"])],
            dormitory: [fiammettaAssignment(["菲亚梅塔"])],
          },
        },
      ],
    }),
    catalog,
  );
  assert.deepEqual(delayedQueueFiammetta.fiammettaWarnings, []);

  const directFiammetta = calculateEfficiency(
    fiammettaDocument({
      mode: "direct",
      fiammetta: { direct: { operators: ["德克萨斯", "砾", "红云"] } },
      plans: [
        {
          duration: 720,
          rooms: {
            trading: [fiammettaAssignment(["德克萨斯"])],
            manufacture: [fiammettaAssignment(["砾", "红云"])],
            dormitory: [fiammettaAssignment(["菲亚梅塔"])],
          },
        },
      ],
    }),
    catalog,
  );
  assert.deepEqual(directFiammetta.fiammettaWarnings, [
    "菲亚梅塔无法完全恢复这些干员心情",
  ]);
  assert.equal(directFiammetta.fiammetta.totalRecovery, 24);

  const maaImported = parseMaaScheduleText(
    JSON.stringify({
      layout: [{ type: "dormitory", level: 5 }],
      plans: [
        {
          rooms: { dormitory: [{}] },
          Fiammetta: { enable: true, target: "德克萨斯", order: "pre" },
        },
        { rooms: { dormitory: [{}] } },
      ],
    }),
  ).document;
  assert.equal(maaImported.settings.fiammettaMode, "queue");
  assert.deepEqual(maaImported.fiammetta.queue[0].operators, ["德克萨斯"]);
  const maaExported = JSON.parse(
    serializeMaaSchedule({
      ...maaImported,
      fiammetta: {
        queue: [{ operators: ["德克萨斯"] }, {}],
      },
    }),
  );
  assert.deepEqual(maaExported.plans[0].Fiammetta, {
    enable: true,
    target: "德克萨斯",
    order: "pre",
  });
  const directMaaExported = JSON.parse(
    serializeMaaSchedule({
      ...maaImported,
      settings: { ...maaImported.settings, fiammettaMode: "direct" },
      fiammetta: {
        direct: { operators: ["德克萨斯", "砾"] },
      },
    }),
  );
  assert.deepEqual(
    directMaaExported.plans.map(({ Fiammetta }) => Fiammetta),
    [
      { enable: true, target: "德克萨斯", order: "pre" },
      { enable: true, target: "砾", order: "pre" },
    ],
  );
}

async function main() {
  const runtime = await loadRuntime();
  try {
    runTests(runtime);
    console.log("efficiency regression: passed");
  } finally {
    await runtime.close();
  }
}

await main();
