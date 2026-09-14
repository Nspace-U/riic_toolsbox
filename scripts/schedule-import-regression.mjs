import assert from "node:assert/strict";
import { createServer } from "vite";

const projectRoot = process.cwd();
const vite = await createServer({
  root: projectRoot,
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});

try {
  const [
    textModule,
    maaModule,
    catalogModule,
    parseModule,
    calculateModule,
    importLayoutModule,
    specialOperatorsModule,
  ] = await Promise.all([
    vite.ssrLoadModule("/src/adapters/textSchedule.ts"),
    vite.ssrLoadModule("/src/adapters/maaSchedule.ts"),
    vite.ssrLoadModule("/src/utils/efficiency/catalog.ts"),
    vite.ssrLoadModule("/src/utils/parseTorappuData.ts"),
    vite.ssrLoadModule("/src/utils/efficiency/calculate.ts"),
    vite.ssrLoadModule("/src/utils/importLayout.ts"),
    vite.ssrLoadModule("/src/utils/specialOperators.ts"),
  ]);
  const rawText = `满血 252
一天三换
-=-
满血 252，右侧 1313

导入说明第二行
菲亚梅塔 007 阿罗玛、槐琥
-=-
EXP 52.2k | 贵金属 46.6k
12 小时 | 6 小时
控制中枢
控制中枢
阿米娅0 |
阿米娅0 |
---
制造站（中级作战记录）
制造站
35% 35% 35% | 105%
35% 35% 35% | 105%
---
发电站
发电站
20% |
20% |
---
加工站 / 训练室
办公室
煌0 逻各斯0 伺夜0 | 任意精英干员
煌0 逻各斯0 伺夜0 | 任意精英干员
---
宿舍
宿舍
迷迭香0 |
迷迭香0 |`;
  const parsed = textModule.parseTextSchedule(rawText);
  assert.equal(parsed.inferredLayout, true);
  assert.equal(parsed.document.plans.length, 2);
  assert.equal(
    parsed.document.description,
    "满血 252，右侧 1313\n\n导入说明第二行\nEXP 52.2k | 贵金属 46.6k",
  );
  assert.equal(parsed.document.plans[0].description, undefined);
  assert.equal(parsed.document.plans[0].duration, 720);
  assert.equal(parsed.document.plans[0].rooms.processing[0].operators[0], "煌");
  assert.equal(
    parsed.document.plans[0].rooms.training[0].operators[0],
    "逻各斯",
  );
  assert.equal(
    parsed.document.plans[0].rooms.manufacture[0].product,
    "Battle Record",
  );
  assert.equal(
    parsed.document.plans[0].rooms.manufacture[0].description,
    "105%",
  );

  assert.deepEqual(importLayoutModule.dormitoryLevels(4, 40), [1, 1, 1, 1]);

  const characterTable = await import(
    "../public/assets/gamedata/latest/excel/character_table.json",
    {
      with: { type: "json" },
    }
  );
  const buildingData = await import(
    "../public/assets/gamedata/latest/excel/building_data.json",
    {
      with: { type: "json" },
    }
  );
  const gamedataConst = await import(
    "../public/assets/gamedata/latest/excel/gamedata_const.json",
    {
      with: { type: "json" },
    }
  );
  const metadata = await import(
    "../public/assets/gamedata/latest/torappu-meta.json",
    {
      with: { type: "json" },
    }
  );
  const operators = parseModule.parseTorappuData(
    characterTable.default,
    buildingData.default,
    metadata.default,
    gamedataConst.default.termDescriptionDict,
    gamedataConst.default.richTextStyles,
  );
  const terms = Object.fromEntries(
    Object.entries(gamedataConst.default.termDescriptionDict).map(
      ([key, term]) => [
        key,
        { name: term.termName, definition: term.description },
      ],
    ),
  );
  const catalog = catalogModule.createEfficiencyCatalog(operators, {}, terms);
  const document = {
    layout: [
      { type: "control", level: 5 },
      { type: "manufacture", level: 3 },
      { type: "power", level: 3 },
    ],
    plans: [
      {
        name: "队列1",
        duration: 720,
        rooms: {
          control: [{ operators: ["莱茵生命"] }],
          manufacture: [
            { product: "Battle Record", operators: ["35%", "35%", "35%"] },
          ],
          power: [{ operators: ["20%"] }],
        },
      },
    ],
  };
  const serialized = JSON.parse(
    maaModule.serializeMaaSchedule(document, { catalog }),
  );
  assert.deepEqual(serialized.plans[0].rooms.manufacture[0].operators, [
    "断罪者",
    "食铁兽",
    "酒神",
  ]);
  assert.equal(serialized.plans[0].rooms.power[0].operators[0], "格雷伊");
  const result = calculateModule.calculateEfficiency(document, catalog);
  assert.equal(result.warnings.length, 0);
  const manufactureResult = result.plans[0].facilities.find(
    (facility) => facility.facility.type === "manufacture",
  );
  assert.equal(manufactureResult?.moodEfficiency, 0);
  assert.equal(manufactureResult?.operatorSkillEfficiency, 105);

  const termFallbackCatalog = {
    operators: {
      甲: { name: "甲", termKeys: ["term"] },
      乙: { name: "乙", termKeys: ["term"] },
    },
    terms: { term: { name: "术语", members: [] } },
  };
  assert.deepEqual(
    specialOperatorsModule.specialOperatorTermMembers(
      "术语",
      termFallbackCatalog,
    ),
    ["甲", "乙"],
  );
  const termSerialized = JSON.parse(
    maaModule.serializeMaaSchedule(
      {
        layout: [{ type: "control", level: 5 }],
        plans: [{ rooms: { control: [{ operators: ["术语"] }] } }],
      },
      { catalog: termFallbackCatalog },
    ),
  );
  assert.deepEqual(termSerialized.plans[0].rooms.control[0].operators, ["甲"]);

  const crossRoomMapping = {
    layout: [
      { type: "manufacture", level: 3 },
      { type: "manufacture", level: 3 },
    ],
    plans: [
      {
        name: "队列1",
        duration: 720,
        rooms: {
          manufacture: [
            { product: "Pure Gold", operators: ["幽灵鲨"] },
            { product: "Pure Gold", operators: ["40%"] },
          ],
        },
      },
    ],
  };
  const crossRoomSerialized = JSON.parse(
    maaModule.serializeMaaSchedule(crossRoomMapping, { catalog }),
  );
  assert.equal(
    crossRoomSerialized.plans[0].rooms.manufacture[1].operators[0],
    "斯卡蒂",
  );
  console.log("schedule import regression: passed");
} finally {
  await vite.close();
}
