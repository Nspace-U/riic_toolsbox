import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const assetRoot = path.join(projectRoot, "public", "assets");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadRuntime() {
  const vite = await createServer({
    root: projectRoot,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    logLevel: "error",
  });
  try {
    const [parseModule, catalogModule, calculateModule, maaModule] =
      await Promise.all([
        vite.ssrLoadModule("/src/utils/parseTorappuData.ts"),
        vite.ssrLoadModule("/src/utils/efficiency/catalog.ts"),
        vite.ssrLoadModule("/src/utils/efficiency/calculate.ts"),
        vite.ssrLoadModule("/src/adapters/maaSchedule.ts"),
      ]);
    const [characterTable, buildingData, gamedataConst, metadata] =
      await Promise.all([
        readJson(
          path.join(
            assetRoot,
            "gamedata",
            "latest",
            "excel",
            "character_table.json",
          ),
        ),
        readJson(
          path.join(
            assetRoot,
            "gamedata",
            "latest",
            "excel",
            "building_data.json",
          ),
        ),
        readJson(
          path.join(
            assetRoot,
            "gamedata",
            "latest",
            "excel",
            "gamedata_const.json",
          ),
        ),
        readJson(
          path.join(assetRoot, "gamedata", "latest", "torappu-meta.json"),
        ),
      ]);
    const operators = parseModule.parseTorappuData(
      characterTable,
      buildingData,
      metadata,
      gamedataConst.termDescriptionDict ?? {},
      gamedataConst.richTextStyles ?? {},
    );
    const skillFiles = Object.fromEntries(
      await Promise.all(
        operators.map(async (operator) => {
          try {
            return [
              operator.id,
              await readJson(
                path.join(assetRoot, "operator-skills", `${operator.id}.json`),
              ),
            ];
          } catch {
            return [operator.id, undefined];
          }
        }),
      ),
    );
    const terms = Object.fromEntries(
      Object.entries(gamedataConst.termDescriptionDict ?? {}).map(
        ([key, term]) => [
          key,
          { name: term.termName, definition: term.description },
        ],
      ),
    );
    return {
      calculateEfficiency: calculateModule.calculateEfficiency,
      parseMaaScheduleText: maaModule.parseMaaScheduleText,
      serializeMaaSchedule: maaModule.serializeMaaSchedule,
      catalog: catalogModule.createEfficiencyCatalog(
        operators,
        skillFiles,
        terms,
      ),
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
        termKeys: [],
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
              product: "Pure Gold",
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
    room.product = "Pure Gold";
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
            product: "Pure Gold",
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
            product: "Pure Gold",
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
          trading: [{ ...assignment(["温蒂"], {}), product: "Orundum" }],
          manufacture: [{ ...assignment(["砾"], {}), product: "Pure Gold" }],
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

function contribution(result, operator) {
  const value = result.operatorContributions.find(
    (item) => item.operator === operator,
  );
  assert.ok(value);
  return value;
}

function assertSkillDetails(result, operators) {
  assert.deepEqual(
    [...new Set(result.combinationDetails.map((detail) => detail.operator))],
    operators,
  );
}

function runTests(runtime) {
  const {
    calculateEfficiency,
    catalog,
    parseMaaScheduleText,
    serializeMaaSchedule,
  } = runtime;
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
  assert.ok(
    partialManufacture.operatorContributions.some(
      (item) => item.operator === "温蒂",
    ),
  );

  const dailyOutput = calculateEfficiency(dailyOutputDocument(), catalog);
  assert.deepEqual(
    dailyOutput.dailyOutputs.map(({ kind, product }) => `${kind}:${product}`),
    [
      "production:Orundum",
      "production:Pure Gold",
      "production:Drone",
      "production:Credit",
      "production:Recruit Refresh",
      "net:Originium Shard",
    ],
  );
  const dailyClue = dailyOutput.dailyProductions.find(
    ({ product }) => product === "Clue",
  );
  const dailyCredit = dailyOutput.dailyOutputs.find(
    ({ product }) => product === "Credit",
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
      ({ kind, product }) => kind === "net" && product === "Originium Shard",
    )?.amountPerDay ?? 0) < 0,
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
      tradingProduct: "Orundum",
      duration: 2880,
    }),
    catalog,
  );
  const overflowZero = calculateEfficiency(
    documentFor({
      trading: ["温蒂"],
      manufacture: ["Lancet-2"],
      tradingProduct: "Orundum",
      duration: 2880,
      settings: { overflowMode: "zero" },
    }),
    catalog,
  );
  const continuedGold = overflowContinue.dailyOutputs.find(
    ({ kind, product }) => kind === "production" && product === "Pure Gold",
  );
  const truncatedGold = overflowZero.dailyOutputs.find(
    ({ kind, product }) => kind === "production" && product === "Pure Gold",
  );
  assert.ok(continuedGold);
  assert.ok(truncatedGold);
  assert.ok(truncatedGold.amountPerDay < continuedGold.amountPerDay);
  const continuedShard = overflowContinue.dailyOutputs.find(
    ({ kind, product }) => kind === "net" && product === "Originium Shard",
  );
  const truncatedShard = overflowZero.dailyOutputs.find(
    ({ kind, product }) => kind === "net" && product === "Originium Shard",
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
  assert.deepEqual(contribution(wendyManufacture, "砾"), {
    operator: "砾",
    baseEfficiency: 1,
    skillEfficiency: 0,
    efficiency: 1,
    sourceFacility: "manufacture",
  });
  assert.equal(contribution(wendyManufacture, "温蒂").skillEfficiency, 45);

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
  assert.equal(
    contribution(percentageWendyManufacture, "35%").skillEfficiency,
    0,
  );

  const percentageHuaihu = calculateEfficiency(
    documentFor({
      manufacture: ["槐琥", "35%"],
      eliteLevels: { 槐琥: 2 },
    }),
    catalog,
  );
  const percentageHuaihuManufacture = manufactureResult(percentageHuaihu);
  assert.equal(percentageHuaihuManufacture.skillEfficiency, 70);
  assert.equal(
    contribution(percentageHuaihuManufacture, "槐琥").skillEfficiency,
    35,
  );
  assert.equal(
    contribution(percentageHuaihuManufacture, "35%").skillEfficiency,
    35,
  );

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
                product: "Pure Gold",
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
                product: "Pure Gold",
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
    Math.abs(recoveringTotterManufacture.skillEfficiency - 27.5) < 1e-9,
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
  assert.ok(
    Math.abs(
      (contribution(redCloudCapacityManufacture, "红云").skillEfficiency ?? 0) -
        26.736842105263158,
    ) < 1e-9,
  );

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
  assert.ok(
    Math.abs(
      (contribution(bubbleCapacityManufacture, "泡泡").skillEfficiency ?? 0) -
        23.333333333333332,
    ) < 1e-9,
  );

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
  assert.equal(contribution(huaihuManufacture, "槐琥").skillEfficiency, 35);
  assert.equal(contribution(huaihuManufacture, "砾").skillEfficiency, 35);

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
  assert.equal(
    contribution(clearedDerivedManufacture, "槐琥").skillEfficiency,
    0,
  );
  assert.equal(
    contribution(clearedDerivedManufacture, "砾").skillEfficiency,
    0,
  );

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
  assert.equal(contribution(mutualManufacture, "温蒂").skillEfficiency, 45);
  assert.equal(contribution(mutualManufacture, "冬时").skillEfficiency, 20);

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
  assert.equal(tradingResult(jieManualElite).efficiency, 145);

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
  assert.deepEqual(delayedQueueFiammetta.fiammettaWarnings, [
    "菲亚梅塔在2队列结束后无法恢复心情",
  ]);

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
