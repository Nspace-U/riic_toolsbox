import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

const projectRoot = process.cwd();
const packageRoot = path.join(projectRoot, "packages", "riic-efficiency");
const packageModule = await import(
  pathToFileURL(path.join(packageRoot, "dist", "index.js")).href
);
const operatorFiles = await Promise.all(
  (await readdir(path.join(packageRoot, "data", "operators")))
    .filter((fileName) => fileName.endsWith(".json"))
    .map(async (fileName) =>
      JSON.parse(
        await readFile(
          path.join(packageRoot, "data", "operators", fileName),
          "utf8",
        ),
      ),
    ),
);
const termsData = JSON.parse(
  await readFile(path.join(packageRoot, "data", "terms.json"), "utf8"),
);
const componentCatalog = packageModule.createEfficiencyCatalog(
  operatorFiles,
  termsData.terms,
);
const vite = await createServer({
  root: projectRoot,
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});

try {
  const [textModule, maaModule, scheduleModule] = await Promise.all([
    vite.ssrLoadModule("/src/adapters/textSchedule.ts"),
    vite.ssrLoadModule("/src/adapters/maaSchedule.ts"),
    vite.ssrLoadModule("/src/utils/schedule.ts"),
  ]);
  const importLayoutModule = packageModule;
  const specialOperatorsModule = packageModule;
  const rawText = `满血 252
一天三换
-=-
满血 252，右侧 1313

导入说明第二行
菲亚梅塔 007 阿罗玛、槐琥
-=-
EXP 52.2k | 赤金 46.6k
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
  const textTerms = {
    "cc.g.elite": {
      name: "精英干员",
      definition: "包含以下干员\n迷迭香、煌、逻各斯、烛煌、电弧、真言、机械师",
    },
  };
  const parsed = textModule.parseTextSchedule(rawText, textTerms);
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
    "中级作战记录",
  );
  assert.equal(
    parsed.document.plans[0].rooms.manufacture[0].description,
    undefined,
  );

  const textProducts = textModule.parseTextSchedule(
    `产品映射
一天一换
-=-
-=-
EXP 0
12 小时
制造站（赤金）
制造站
|
---
制造站（中级作战记录）
制造站
|
---
贸易站（龙门商法）
贸易站
|
---
贸易站（开采协力）
贸易站
|`,
    textTerms,
  ).document;
  assert.deepEqual(
    textProducts.plans[0].rooms.manufacture.map(({ product }) => product),
    ["赤金", "中级作战记录"],
  );
  assert.deepEqual(
    textProducts.plans[0].rooms.trading.map(({ product }) => product),
    ["龙门币", "合成玉"],
  );
  assert.throws(
    () =>
      textModule.parseTextSchedule(
        `未知产品
一天一换
-=-
-=-
EXP 0
12 小时
贸易站（未知订单）
贸易站
|`,
        textTerms,
      ),
    /无法识别贸易站产物“未知订单”/,
  );

  function parseDormitoryExample(operators, terms = textTerms) {
    return textModule.parseTextSchedule(
      `宿舍分配
一天一换
-=-
-=-
EXP 0
12 小时
发电站
发电站
甲0 乙0 丙0
---
宿舍
宿舍
    ${operators} |`,
      terms,
    ).document;
  }

  const dormitoryExampleOne = parseDormitoryExample("烛煌0 迷迭香2 森西2");
  assert.deepEqual(
    dormitoryExampleOne.plans[0].rooms.dormitory
      .slice(0, 2)
      .map(({ operators }) => operators ?? []),
    [["烛煌", "森西"], ["迷迭香"]],
  );
  const dormitoryExampleTwo = parseDormitoryExample(
    "杜林0 褐果0 森西2 桃金娘0 至简0 迷迭香0 电弧0 烛煌0",
  );
  assert.deepEqual(
    dormitoryExampleTwo.plans[0].rooms.dormitory
      .slice(0, 3)
      .map(({ operators }) => operators ?? []),
    [["迷迭香", "杜林", "褐果", "森西", "桃金娘"], ["电弧", "至简"], ["烛煌"]],
  );
  const runtimeTermOnlyOne = parseDormitoryExample("烛煌0 迷迭香2 森西2", {
    "custom.elite": { name: "精英干员", members: ["烛煌"] },
  });
  assert.deepEqual(
    runtimeTermOnlyOne.plans[0].rooms.dormitory
      .slice(0, 2)
      .map(({ operators }) => operators ?? []),
    [["烛煌", "迷迭香", "森西"], []],
  );

  const maaParsed = maaModule.parseMaaScheduleText(
    JSON.stringify({
      layout: [
        { type: "control", level: 5 },
        { type: "trading", level: 3 },
      ],
      plans: [
        {
          rooms: {
            control: [{}],
            trading: [{ operators: ["阿米娅"], description: "Maa 描述" }],
          },
        },
      ],
    }),
  );
  assert.equal(
    maaParsed.document.plans[0].rooms.trading[0].description,
    undefined,
  );
  assert.equal(maaParsed.document.plans[0].drones, undefined);
  const maaDroneRoundTrip = maaModule.parseMaaScheduleText(
    JSON.stringify({
      layout: [
        { type: "trading", level: 3 },
        { type: "manufacture", level: 3 },
      ],
      plans: [
        {
          drones: {
            enable: true,
            room: "trading",
            index: 1,
            rule: "all",
            order: "post",
          },
          rooms: {
            trading: [{ product: "LMD" }],
            manufacture: [{ product: "Pure Gold" }],
          },
        },
      ],
    }),
  ).document;
  assert.equal(maaDroneRoundTrip.plans[0].drones?.index, 0);
  const maaDroneSerialized = JSON.parse(
    maaModule.serializeMaaSchedule(maaDroneRoundTrip),
  );
  assert.equal(maaDroneSerialized.plans[0].drones.index, 1);
  assert.equal(maaDroneSerialized.plans[0].drones.order, "post");
  const maaDescriptionSerialized = JSON.parse(
    maaModule.serializeMaaSchedule({
      layout: [
        { type: "trading", level: 3 },
        { type: "manufacture", level: 3 },
      ],
      plans: [
        {
          rooms: {
            trading: [{ operators: ["阿米娅"], description: "Maa 描述" }],
            manufacture: [{ description: "空房间描述" }],
          },
        },
      ],
    }),
  ).plans[0].rooms;
  assert.equal(maaDescriptionSerialized.trading[0].description, undefined);
  assert.equal(maaDescriptionSerialized.manufacture[0].description, undefined);

  const maaProducts = {
    layout: [
      { type: "trading", level: 3 },
      { type: "trading", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "manufacture", level: 3 },
    ],
    plans: [
      {
        rooms: {
          trading: [{ product: "LMD" }, { product: "Orundum" }],
          manufacture: [
            { product: "Pure Gold" },
            { product: "Battle Record" },
            { product: "Originium Shard" },
            { product: "Dualchip" },
          ],
        },
      },
    ],
  };
  const maaProductsParsed = maaModule.parseMaaScheduleText(
    JSON.stringify(maaProducts),
  );
  assert.deepEqual(
    maaProductsParsed.document.plans[0].rooms.trading.map(
      ({ product }) => product,
    ),
    ["龙门币", "合成玉"],
  );
  assert.deepEqual(
    maaProductsParsed.document.plans[0].rooms.manufacture.map(
      ({ product }) => product,
    ),
    ["赤金", "中级作战记录", "源石碎片", "Dualchip"],
  );
  assert.equal(
    maaProductsParsed.document.plans[0].rooms.manufacture[2].sourceMaterial,
    "固源岩",
  );
  const maaProductsSerialized = JSON.parse(
    maaModule.serializeMaaSchedule(maaProductsParsed.document),
  ).plans[0].rooms;
  assert.deepEqual(
    maaProductsSerialized.trading.map(({ product }) => product),
    ["LMD", "Orundum"],
  );
  assert.deepEqual(
    maaProductsSerialized.manufacture.map(({ product }) => product),
    ["Pure Gold", "Battle Record", "Originium Shard", "Dualchip"],
  );
  assert.equal(maaProductsSerialized.manufacture[2].sourceMaterial, "固源岩");

  assert.deepEqual(importLayoutModule.dormitoryLevels(4, 40), [1, 1, 1, 1]);
  assert.deepEqual(importLayoutModule.dormitoryLevels(4, 60), [3, 1, 1, 1]);

  const fullFunctionalLayout = importLayoutModule.inferScheduleLayout([
    {
      rooms: {
        control: [{}],
        trading: [{ operators: ["甲", "乙", "丙"] }],
        manufacture: [{ operators: ["甲", "乙", "丙"] }],
        power: [{ operators: ["甲"] }, { operators: ["乙"] }],
      },
    },
  ]);
  assert.deepEqual(
    fullFunctionalLayout
      .filter((entry) =>
        ["meeting", "processing", "hire", "training"].includes(entry.type),
      )
      .map(({ type, level }) => [type, level]),
    [
      ["meeting", 3],
      ["processing", 3],
      ["hire", 3],
      ["training", 3],
    ],
  );
  assert.deepEqual(
    fullFunctionalLayout
      .filter((entry) => entry.type === "dormitory")
      .map(({ level }) => level),
    [5, 5, 5, 3],
  );

  const fallbackFunctionalLayout = importLayoutModule.inferScheduleLayout([
    {
      rooms: {
        control: [{}],
        trading: [{ operators: ["甲", "乙", "丙"] }],
        manufacture: [{ operators: ["甲", "乙", "丙"] }],
        power: [{ operators: ["甲"] }],
      },
    },
  ]);
  assert.deepEqual(
    fallbackFunctionalLayout
      .filter((entry) =>
        ["meeting", "processing", "hire", "training"].includes(entry.type),
      )
      .map(({ type, level }) => [type, level]),
    [
      ["meeting", 1],
      ["processing", 3],
      ["hire", 1],
      ["training", 3],
    ],
  );
  assert.deepEqual(
    fallbackFunctionalLayout
      .filter((entry) => entry.type === "dormitory")
      .map(({ level }) => level),
    [3, 1, 1, 1],
  );

  const catalog = componentCatalog;
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
            { product: "中级作战记录", operators: ["35%", "35%", "35%"] },
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
  const result = packageModule.calculateEfficiency(document, { catalog });
  assert.equal(result.warnings.length, 0);
  const manufactureResult = result.plans[0].facilities.find(
    (facility) => facility.facility.type === "manufacture",
  );
  assert.equal(manufactureResult?.moodEfficiency, 3);
  assert.equal(manufactureResult?.operatorSkillEfficiency, 105);
  assert.equal(manufactureResult?.efficiency, 208);
  const powerResult = result.plans[0].facilities.find(
    (facility) => facility.facility.type === "power",
  );
  assert.equal(powerResult?.moodEfficiency, 5);
  assert.equal(powerResult?.operatorSkillEfficiency, 20);
  assert.equal(powerResult?.efficiency, 125);

  const timedSource = {
    layout: [{ type: "trading", level: 3 }],
    plans: [
      {
        name: "早班",
        duration: 1,
        period: [["00:00", "05:59"]],
        rooms: { trading: [{ product: "LMD", operators: [] }] },
      },
      {
        name: "晚班",
        duration: 1,
        period: [["06:00", "23:59"]],
        rooms: { trading: [{ product: "LMD", operators: [] }] },
      },
    ],
  };
  const timedParsed = maaModule.parseMaaScheduleText(
    JSON.stringify(timedSource),
  ).document;
  assert.deepEqual(
    timedParsed.plans.map((plan) => plan.duration),
    [360, 1080],
  );
  const timedSerialized = JSON.parse(
    maaModule.serializeMaaSchedule(timedParsed, { catalog }),
  );
  assert.deepEqual(timedSerialized.plans[0].period, [["00:00", "05:59"]]);

  const disabledSource = {
    ...timedSource,
    plans: timedSource.plans.map(({ period, ...plan }) => ({
      ...plan,
      settings: { period },
    })),
  };
  const disabledParsed = maaModule.parseMaaScheduleText(
    JSON.stringify(disabledSource),
  ).document;
  assert.equal(disabledParsed.plans[0].period, undefined);
  assert.deepEqual(disabledParsed.plans[0].settings?.period, [
    ["00:00", "05:59"],
  ]);
  const disabledSerialized = JSON.parse(
    maaModule.serializeMaaSchedule(disabledParsed, { catalog }),
  );
  assert.equal(disabledSerialized.plans[0].period, undefined);
  assert.deepEqual(disabledSerialized.plans[0].settings.period, [
    ["00:00", "05:59"],
  ]);

  const duplicatePeriodSource = {
    ...timedSource,
    plans: timedSource.plans.map((plan) => ({
      ...plan,
      settings: { period: [["23:00", "23:59"]] },
    })),
  };
  const duplicateParsed = maaModule.parseMaaScheduleText(
    JSON.stringify(duplicatePeriodSource),
  ).document;
  assert.equal(duplicateParsed.plans[0].settings, undefined);

  const rollingPercentageDocument = {
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
            { product: "中级作战记录", operators: ["35%", "35%", "35%"] },
            { product: "中级作战记录" },
          ],
        },
      },
      {
        name: "队列2",
        duration: 720,
        rooms: {
          manufacture: [
            {
              product: "中级作战记录",
              operators: ["35%", "35%"],
            },
            { product: "中级作战记录", operators: ["35%", "35%"] },
          ],
        },
      },
      {
        name: "队列3",
        duration: 720,
        rooms: {
          manufacture: [
            { product: "中级作战记录", operators: ["35%", "35%", "35%"] },
            { product: "中级作战记录" },
          ],
        },
      },
    ],
  };
  const rollingPercentageSerialized = JSON.parse(
    maaModule.serializeMaaSchedule(rollingPercentageDocument),
  );
  assert.deepEqual(
    rollingPercentageSerialized.plans.map((plan) =>
      plan.rooms.manufacture.flatMap((room) => room.operators ?? []),
    ),
    [
      ["断罪者", "食铁兽", "酒神"],
      ["弑君者", "裂响", "断罪者", "食铁兽"],
      ["酒神", "弑君者", "裂响"],
    ],
  );
  assert.throws(
    () =>
      maaModule.serializeMaaSchedule({
        layout: [
          { type: "manufacture", level: 3 },
          { type: "manufacture", level: 3 },
        ],
        plans: [
          {
            rooms: {
              manufacture: [
                {
                  product: "中级作战记录",
                  operators: ["35%", "35%", "35%"],
                },
                {
                  product: "中级作战记录",
                  operators: ["35%", "35%", "35%"],
                },
              ],
            },
          },
        ],
      }),
    /制造站 中的 35% 没有可用的百分比映射干员/,
  );

  const termFallbackCatalog = {
    operators: {
      甲: { name: "甲" },
      乙: { name: "乙" },
    },
    terms: { term: { name: "术语", members: ["甲", "乙"] } },
  };
  assert.deepEqual(
    specialOperatorsModule.specialOperatorTermMembers(
      "术语",
      termFallbackCatalog,
    ),
    ["甲", "乙"],
  );
  const dynamicTerms = { custom: { name: "自定义术语" } };
  assert.equal(
    specialOperatorsModule.specialOperatorAvatarLabel("35%", dynamicTerms),
    "35%",
  );
  assert.equal(
    specialOperatorsModule.specialOperatorAvatarLabel(
      "自定义术语",
      dynamicTerms,
    ),
    "自定",
  );
  const resolveDynamicAvatarLabel =
    specialOperatorsModule.createSpecialOperatorAvatarLabelResolver(
      dynamicTerms,
    );
  assert.equal(resolveDynamicAvatarLabel("阿米娅"), undefined);
  assert.equal(resolveDynamicAvatarLabel("35%"), "35%");
  assert.equal(resolveDynamicAvatarLabel("自定义术语"), "自定");
  assert.equal(resolveDynamicAvatarLabel("不存在的术语"), undefined);
  const resolveUpdatedAvatarLabel =
    specialOperatorsModule.createSpecialOperatorAvatarLabelResolver({
      custom: { name: "更新术语" },
    });
  assert.equal(resolveUpdatedAvatarLabel("自定义术语"), undefined);
  assert.equal(resolveUpdatedAvatarLabel("更新术语"), "更新");
  let termEnumerationCount = 0;
  const trackedTerms = new Proxy(
    { custom: { name: "缓存术语" } },
    {
      ownKeys(target) {
        termEnumerationCount += 1;
        return Reflect.ownKeys(target);
      },
    },
  );
  const cachedAvatarLabel =
    specialOperatorsModule.createSpecialOperatorAvatarLabelResolver(
      trackedTerms,
    );
  assert.equal(cachedAvatarLabel("缓存术语"), "缓存");
  assert.equal(cachedAvatarLabel("缓存术语"), "缓存");
  assert.equal(cachedAvatarLabel("缓存术语"), "缓存");
  assert.equal(termEnumerationCount, 1);
  assert.equal(
    specialOperatorsModule.isKnownSpecialOperator("自定义术语", dynamicTerms),
    true,
  );
  assert.equal(
    specialOperatorsModule.isKnownSpecialOperator("莱茵生命", dynamicTerms),
    false,
  );
  assert.equal(
    scheduleModule.formatDuplicateOperatorWarnings(
      {
        layout: [{ type: "control", level: 5 }],
        plans: [
          {
            rooms: {
              control: [{ operators: ["自定义术语", "自定义术语"] }],
            },
          },
        ],
      },
      dynamicTerms,
    ),
    "",
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
  const termPerPlanSerialized = JSON.parse(
    maaModule.serializeMaaSchedule(
      {
        layout: [{ type: "control", level: 5 }],
        plans: [
          { rooms: { control: [{ operators: ["术语"] }] } },
          { rooms: { control: [{ operators: ["术语"] }] } },
        ],
      },
      { catalog: termFallbackCatalog },
    ),
  );
  assert.deepEqual(
    termPerPlanSerialized.plans.map((plan) => plan.rooms.control[0].operators),
    [["甲"], ["甲"]],
  );

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
            { product: "赤金", operators: ["幽灵鲨"] },
            { product: "赤金", operators: ["40%"] },
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
