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

function assignment(operators, eliteLevels) {
  return {
    operators: [...operators],
    operatorStates: Object.fromEntries(
      operators.map((name) => [
        name,
        { elite: eliteLevels[name] ?? 2, level: 1, mood: 24 },
      ]),
    ),
  };
}

function documentFor({
  control = [],
  trading = [],
  manufacture = [],
  eliteLevels = {},
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
        duration: 720,
        rooms: {
          control: [assignment(control, eliteLevels)],
          trading: [assignment(trading, eliteLevels)],
          manufacture: [
            {
              ...assignment(manufacture, eliteLevels),
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
  assert.equal(wendyManufacture.facilitySkillEfficiency, 0);
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
  assert.equal(facilitySkillManufacture.skillEfficiency, 48);
  assert.equal(facilitySkillManufacture.operatorSkillEfficiency, 45);
  assert.equal(facilitySkillManufacture.facilitySkillEfficiency, 3);
  assertSkillDetails(facilitySkillManufacture, ["温蒂", "斩业星熊"]);

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
