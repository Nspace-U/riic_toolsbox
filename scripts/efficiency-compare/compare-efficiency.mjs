import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  scenarioOperatorNames,
  scenarios,
  scenarioProducts,
  scenarioSourceMaterial,
} from "./scenarios.mjs";

const projectRoot = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const oldProjectRoot = path.resolve(projectRoot, "..", "基建");
const newAssetRoot = path.join(projectRoot, "public", "assets");

const oldScriptPaths = [
  "src/js/operator-data.js",
  "src/js/simulator/data.js",
  "src/js/simulator/store.js",
  "src/js/simulator/efficiency/state.js",
  "src/js/simulator/efficiency/data.js",
  "src/js/simulator/efficiency/condition.js",
  "src/js/simulator/efficiency/value.js",
  "src/js/simulator/efficiency/attribute.js",
  "src/js/simulator/efficiency/aggregate.js",
  "src/js/simulator/efficiency/skillvar.js",
  "src/js/simulator/efficiency/trade.js",
  "src/js/simulator/efficiency/index.js",
  "src/js/simulator/efficiency/calc.js",
  "src/js/simulator/efficiency/mood.js",
  "src/js/simulator/efficiency/dorm.js",
  "src/js/simulator/efficiency/production/capacity.js",
  "src/js/simulator/efficiency/production/trade.js",
  "src/js/simulator/efficiency/production/manu.js",
  "src/js/simulator/efficiency/production/power.js",
  "src/js/simulator/efficiency/production/reception.js",
  "src/js/simulator/efficiency/production/office.js",
  "src/js/simulator/efficiency/production/index.js",
];

const ROOM_MAP = {
  control: "ctrl",
  trading: "trade",
  manufacture: "manu",
  power: "power",
  meeting: "reception",
  hire: "office",
  processing: "workshop",
  training: "train",
  dormitory: "dorm",
};

const PRODUCT_MAP = {
  LMD: "龙门商法",
  Orundum: "开采协力",
  "Pure Gold": "贵金属",
  "Battle Record": "作战记录",
  "Originium Shard": "源石碎片",
};

const OLD_TO_NEW_ROOM = Object.fromEntries(
  Object.entries(ROOM_MAP).map(([type, oldType]) => [oldType, type]),
);

function operatorForOld(entry) {
  return {
    name: entry.name,
    mood: entry.mood,
    forcedElite: entry.elite,
    forcedLevel: entry.level,
    desc: "",
  };
}

function queueCountOf(scenario) {
  return Math.max(1, scenario.repeat ?? 1);
}

function operatorsFor(scenario, type, roomIndex, queueIndex) {
  const room = scenario.assignments?.[type]?.[roomIndex];
  if (!Array.isArray(room)) return [];
  if (room.length > 0 && Array.isArray(room[0])) {
    return room[queueIndex] ?? room[0] ?? [];
  }
  return room;
}

function settingsOf(scenario) {
  return {
    clueExchanging: scenario.settings?.clueExchanging === true,
    dormFullTreat: scenario.settings?.dormFullTreat !== false,
    featherFixedOps: [...(scenario.settings?.featherFixedOps ?? [])],
    tradeZiMax: scenario.settings?.tradeZiMax !== false,
    tradeZiProgress: scenario.settings?.tradeZiProgress ?? 0,
    preferMaxJieEfficiency: true,
    overflowMode: scenario.settings?.overflowMode ?? "continue",
    firstItemProgress: scenario.settings?.firstItemProgress ?? 0,
  };
}

function buildNewDocument(scenario) {
  const layout = scenario.layout.map(([type, level]) => ({ type, level }));
  const rooms = {};
  const roomIndexes = {};
  layout.forEach(({ type }) => {
    const roomIndex = roomIndexes[type] ?? 0;
    roomIndexes[type] = roomIndex + 1;
    for (
      let queueIndex = 0;
      queueIndex < queueCountOf(scenario);
      queueIndex += 1
    ) {
      const source = operatorsFor(scenario, type, roomIndex, queueIndex);
      const operatorStates = Object.fromEntries(
        source.map((entry) => [
          entry.name,
          { elite: entry.elite, level: entry.level, mood: entry.mood },
        ]),
      );
      const assignment = {
        operators: source.map((entry) => entry.name),
        operatorStates,
      };
      const product = scenarioProducts(scenario, type, roomIndex);
      const sourceMaterial = scenarioSourceMaterial(scenario, type, roomIndex);
      if (product !== undefined) assignment.product = product;
      if (sourceMaterial !== undefined)
        assignment.sourceMaterial = sourceMaterial;
      (rooms[type] ??= [])[roomIndex] ??= [];
      rooms[type][roomIndex].push(assignment);
    }
  });

  const plans = Array.from({ length: queueCountOf(scenario) }, (_, index) => {
    const planRooms = {};
    Object.entries(rooms).forEach(([type, roomEntries]) => {
      planRooms[type] = roomEntries.map(
        (queueAssignments) => queueAssignments[index] ?? {},
      );
    });
    return {
      name: `队列${index + 1}`,
      duration: Math.round((scenario.durationHours ?? 12) * 60),
      rooms: planRooms,
    };
  });

  return {
    title: scenario.title,
    settings: settingsOf(scenario),
    layout,
    plans,
  };
}

function buildOldSchedule(scenario, runtime) {
  const facilities = [];
  const typeIndexes = {};
  scenario.layout.forEach(([type, level]) => {
    const oldType = ROOM_MAP[type];
    const index = (typeIndexes[type] ?? 0) + 1;
    typeIndexes[type] = index;
    const product = scenarioProducts(scenario, type, index - 1);
    const sourceMaterial = scenarioSourceMaterial(scenario, type, index - 1);
    facilities.push({
      id: `compare-${oldType}-${index}`,
      type: oldType,
      level,
      index,
      productType: PRODUCT_MAP[product] ?? "",
      sourceMaterial: sourceMaterial ?? "固源岩",
      name: `${oldType}${index}`,
    });
  });

  const queues = Array.from(
    { length: queueCountOf(scenario) },
    (_, queueIndex) => {
      const assignments = {};
      facilities.forEach((facility) => {
        const type = Object.keys(ROOM_MAP).find(
          (key) => ROOM_MAP[key] === facility.type,
        );
        const source = operatorsFor(
          scenario,
          type,
          facility.index - 1,
          queueIndex,
        );
        const slots = runtime.SimData.facilitySlotCount(
          facility.type,
          facility.level,
        );
        assignments[facility.id] = Array.from(
          { length: slots },
          (_, slotIndex) => {
            const entry = source[slotIndex];
            return entry ? operatorForOld(entry) : { name: "", desc: "" };
          },
        );
      });
      return {
        id: `compare-queue-${queueIndex + 1}`,
        interval: scenario.durationHours ?? 12,
        assignments,
      };
    },
  );

  return {
    id: `compare-${scenario.id}`,
    name: scenario.title,
    desc: "",
    layout: { facilities },
    queues,
    settings: {
      clueExchanging: scenario.settings?.clueExchanging === true,
      dormFullTreat: scenario.settings?.dormFullTreat !== false,
      featherFixedOps: [...(scenario.settings?.featherFixedOps ?? [])],
      autoRest: false,
    },
  };
}

function responseForFile(filePath) {
  return readFile(filePath).then((body) => ({
    ok: true,
    status: 200,
    text: async () => body.toString("utf8"),
    json: async () => JSON.parse(body.toString("utf8")),
    arrayBuffer: async () =>
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  }));
}

function createOldFetch() {
  return async (resource) => {
    const value = typeof resource === "string" ? resource : resource?.url;
    const relativePath = String(value ?? "")
      .split(/[?#]/, 1)[0]
      .replace(/^\/+/, "");
    const filePath = path.resolve(oldProjectRoot, relativePath);
    if (!filePath.startsWith(oldProjectRoot)) {
      return { ok: false, status: 403 };
    }
    try {
      return await responseForFile(filePath);
    } catch {
      return { ok: false, status: 404 };
    }
  };
}

async function loadOldRuntime() {
  const localStorageValues = new Map();
  let activeSettings = {};
  const localStorage = {
    getItem(key) {
      return localStorageValues.get(String(key)) ?? null;
    },
    setItem(key, value) {
      localStorageValues.set(String(key), String(value));
    },
    removeItem(key) {
      localStorageValues.delete(String(key));
    },
    clear() {
      localStorageValues.clear();
    },
  };
  const context = {
    console,
    fetch: createOldFetch(),
    localStorage,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Map,
    Set,
    Promise,
    URL,
    Math,
    Date,
    JSON,
    Number,
    String,
    Boolean,
    Object,
    Array,
    RegExp,
    Error,
    TypeError,
    parseInt,
    parseFloat,
    isFinite,
    SimSettings: {
      get: () => ({
        tradeZiMax: activeSettings.tradeZiMax !== false,
        tradeZiProgress: activeSettings.tradeZiProgress ?? 0,
        firstProductProgress: Math.round(
          (activeSettings.firstItemProgress ?? 0) * 100,
        ),
        overflowZeroEff: activeSettings.overflowMode === "zero",
      }),
    },
  };
  context.window = context;
  vm.createContext(context);
  for (const relativePath of oldScriptPaths) {
    const source = await readFile(
      path.join(oldProjectRoot, relativePath),
      "utf8",
    );
    vm.runInContext(source, context, {
      filename: path.join(oldProjectRoot, relativePath),
    });
  }
  await context.OperatorData.init();
  context.setScenarioSettings = (scenario) => {
    activeSettings = scenario.settings ?? {};
  };
  return context;
}

async function loadNewRuntime() {
  const vite = await createServer({
    root: projectRoot,
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
    logLevel: "error",
  });
  const parseModule = await vite.ssrLoadModule(
    "/src/utils/parseTorappuData.ts",
  );
  const catalogModule = await vite.ssrLoadModule(
    "/src/utils/efficiency/catalog.ts",
  );
  const calculateModule = await vite.ssrLoadModule(
    "/src/utils/efficiency/calculate.ts",
  );
  const [characterTable, buildingData, gamedataConst, metadata] =
    await Promise.all([
      readJson(
        path.join(
          newAssetRoot,
          "gamedata",
          "latest",
          "excel",
          "character_table.json",
        ),
      ),
      readJson(
        path.join(
          newAssetRoot,
          "gamedata",
          "latest",
          "excel",
          "building_data.json",
        ),
      ),
      readJson(
        path.join(
          newAssetRoot,
          "gamedata",
          "latest",
          "excel",
          "gamedata_const.json",
        ),
      ),
      readJson(
        path.join(newAssetRoot, "gamedata", "latest", "torappu-meta.json"),
      ),
    ]);
  const operators = parseModule.parseTorappuData(
    characterTable,
    buildingData,
    metadata,
    gamedataConst.termDescriptionDict ?? {},
    gamedataConst.richTextStyles ?? {},
  );
  const skillFiles = {};
  await Promise.all(
    operators.map(async (operator) => {
      try {
        skillFiles[operator.id] = await readJson(
          path.join(newAssetRoot, "operator-skills", `${operator.id}.json`),
        );
      } catch {
        skillFiles[operator.id] = undefined;
      }
    }),
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
    catalog: catalogModule.createEfficiencyCatalog(
      operators,
      skillFiles,
      terms,
    ),
    close: () => vite.close(),
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function round(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 1e9) / 1e9
    : value;
}

function mapNumbers(value) {
  if (Array.isArray(value)) return value.map(mapNumbers);
  if (!value || typeof value !== "object") return round(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, mapNumbers(item)]),
  );
}

function normalizeSemanticNumbers(value) {
  if (Array.isArray(value)) return value.map(normalizeSemanticNumbers);
  if (!value || typeof value !== "object") return round(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      normalizeSemanticNumbers(item),
    ]),
  );
}

function canonicalMaterialMap(value) {
  const result = {};
  Object.entries(value ?? {}).forEach(([material, rate]) => {
    const key = canonicalProduct(material);
    result[key] = (result[key] ?? 0) + (Number(rate) || 0);
  });
  return result;
}

const OLD_PRODUCT_MAP = {
  龙门币: "LMD",
  合成玉: "Orundum",
  赤金: "Pure Gold",
  作战记录: "Battle Record",
  中级作战记录: "Battle Record",
  源石碎片: "Originium Shard",
  无人机: "Drone",
  信用点: "Clue",
  公开招募标签刷新次数: "Recruit Refresh",
};
const CREDIT_PER_CLUE = 40;

function canonicalProduct(value) {
  return OLD_PRODUCT_MAP[value] ?? value;
}

function productionUnitFactor(product) {
  return product === "信用点" ? 1 / CREDIT_PER_CLUE : 1;
}

function normalizedOrders(orders) {
  return (orders ?? []).map((order) => {
    const note = String(order.note ?? "");
    const name = String(order.name ?? order.order ?? order.orderName ?? "");
    const ignoreEfficiency =
      order.ignoreEfficiency === true ||
      order.ignoreEff === true ||
      note.includes("不受任何订单获取效率");
    const specialRule =
      order.specialRule ??
      (ignoreEfficiency ? "fixed-ignore-efficiency" : undefined) ??
      (note.includes("金额替换") ? "value-replacement" : undefined) ??
      (note.includes("违约") ? "breach" : undefined) ??
      (note.includes("投资") ? "invest" : undefined) ??
      (order.fixed === true ? "fixed-order" : undefined) ??
      (name.includes("特别订单") ? "fixed-order" : undefined);
    return {
      name: name.replace(/\s+/g, ""),
      probability: round(order.probability ?? order.prob),
      quantity: round(order.quantity ?? order.qty),
      time: round(order.time),
      material: canonicalProduct(order.material),
      amount: round(order.amount),
      ...(specialRule ? { specialRule } : {}),
      ...(ignoreEfficiency ? { ignoreEfficiency: true } : {}),
    };
  });
}

function normalizedOrderRule(production) {
  const orders = production?.orders ?? [];
  const rawRule = String(production?.orderRule ?? production?.strategy ?? "");
  if (
    orders.some(
      (order) =>
        order.ignoreEfficiency === true ||
        order.ignoreEff === true ||
        String(order.note ?? "").includes("不受任何订单获取效率"),
    )
  ) {
    return "fixed-ignore-efficiency";
  }
  if (
    orders.some(
      (order) =>
        String(order.note ?? "").includes("金额替换") ||
        String(order.name ?? "").includes("金额替换"),
    )
  )
    return "value-replacement";
  if (
    orders.some(
      (order) =>
        String(order.note ?? "").includes("违约") ||
        String(order.name ?? "").includes("违约"),
    )
  )
    return "breach";
  if (
    orders.some(
      (order) =>
        String(order.note ?? "").includes("投资") ||
        String(order.name ?? "").includes("投资"),
    )
  )
    return "invest";
  if (
    orders.some(
      (order) =>
        order.fixed === true || String(order.name ?? "").includes("特别订单"),
    )
  ) {
    return "fixed-order";
  }
  if (rawRule.includes("固定订单")) return "fixed-order";
  return rawRule || undefined;
}

function normalizedAttributes(type, attributes) {
  if (type === "trading")
    return { orderLimit: mapNumbers(attributes?.orderLimit) };
  if (type === "manufacture")
    return { storageCap: mapNumbers(attributes?.storageCap) };
  return {};
}

function normalizedCapacity(capacity, type) {
  if (!capacity) return undefined;
  const result = {
    base: round(capacity.base),
    skill: round(capacity.skill),
    total: round(capacity.total),
  };
  if (type === "manufacture")
    result.itemVolume = round(capacity.volume ?? capacity.itemVolume);
  return result;
}

function normalizedProduction(
  production,
  type,
  durationHours = 12,
  settings = {},
  facilityCapacity,
) {
  if (!production) return undefined;
  const orderRule = normalizedOrderRule(production);
  const isFixedIgnoreEfficiency = orderRule === "fixed-ignore-efficiency";
  const sourceProduct = String(production.product ?? "");
  const unitFactor = productionUnitFactor(sourceProduct);
  const rawRate =
    (Number(
      production.rawRate ??
        (isFixedIgnoreEfficiency ? production.baseRate : undefined) ??
        production.rate ??
        production.amountPerHour,
    ) || 0) * unitFactor;
  const capacity = production.capacity ?? facilityCapacity;
  const volume = Number(capacity?.volume ?? capacity?.itemVolume) || 1;
  const itemCount = Math.max(
    0,
    Math.floor((Number(capacity?.total) || 0) / volume + 1e-9),
  );
  const rawProgress = Number(settings.firstItemProgress) || 0;
  const progressFraction = rawProgress <= 1 ? rawProgress : rawProgress / 100;
  const itemRate =
    (Number(production.itemRate ?? rawRate / unitFactor) || 0) * unitFactor;
  const explicitCapacityItemRate =
    capacity?.itemRate ?? production.capacityRate;
  const capacityItemRate =
    explicitCapacityItemRate === undefined
      ? itemRate
      : Number(explicitCapacityItemRate) || 0;
  const calculatedBreachTime =
    itemCount > 0 && capacityItemRate > 0
      ? (itemCount - Math.max(0, Math.min(1, progressFraction))) /
        capacityItemRate
      : undefined;
  const breachTime =
    production.breachTime ??
    production.breach?.custom?.time ??
    calculatedBreachTime;
  const overflowed =
    production.overflowed ??
    (breachTime !== undefined && breachTime <= durationHours + 1e-9);
  const effectiveRatio =
    overflowed && settings.overflowMode === "zero"
      ? Math.max(0, Math.min(1, breachTime / durationHours))
      : 1;
  const baseAmountPerHour =
    (Number(production.baseAmountPerHour ?? production.baseRate) || 0) *
    unitFactor;
  const efficiencyMultiplier = isFixedIgnoreEfficiency
    ? 1
    : baseAmountPerHour > 0
      ? rawRate / baseAmountPerHour
      : 1;
  const fallbackBaseMaterialPerHour = Object.fromEntries(
    (production.consumes ?? []).map((item) => [
      canonicalProduct(item.material),
      round(item.baseRate),
    ]),
  );
  const materialPerHour = Object.fromEntries(
    (production.consumes ?? []).map((item) => [
      canonicalProduct(item.material),
      round(
        (Number(item.baseRate) || 0) *
          (isFixedIgnoreEfficiency ? 1 : efficiencyMultiplier),
      ),
    ]),
  );
  const sourceMaterialPerHour = canonicalMaterialMap(
    production.materialPerHour ?? materialPerHour,
  );
  const baseMaterialPerHour = canonicalMaterialMap(
    production.baseMaterialPerHour ??
      (Object.keys(sourceMaterialPerHour).length > 0
        ? Object.fromEntries(
            Object.entries(sourceMaterialPerHour).map(([material, rate]) => [
              material,
              Number(rate) /
                (isFixedIgnoreEfficiency ? 1 : efficiencyMultiplier),
            ]),
          )
        : fallbackBaseMaterialPerHour),
  );
  const normalizedBaseMaterialPerHour = baseMaterialPerHour;
  const effectiveMaterialPerHour =
    production.effectiveMaterialPerHour ??
    (production.consumes?.length > 0 &&
    overflowed &&
    settings.overflowMode === "zero"
      ? canonicalMaterialMap(
          Object.fromEntries(
            production.consumes.map((item) => [
              item.material,
              Math.abs(Number(item.rate) || 0),
            ]),
          ),
        )
      : Object.fromEntries(
          Object.entries(sourceMaterialPerHour).map(([material, rate]) => [
            material,
            Math.abs(Number(rate) || 0) * effectiveRatio,
          ]),
        ));
  const effectiveRate =
    production.effectiveAmountPerHour !== undefined
      ? Number(production.effectiveAmountPerHour) * unitFactor
      : production.rate !== undefined
        ? Number(production.rate) * unitFactor
        : overflowed
          ? rawRate * effectiveRatio
          : rawRate;
  return {
    product: canonicalProduct(sourceProduct),
    orderRule,
    baseAmountPerHour: round(baseAmountPerHour),
    amountPerHour: round(rawRate),
    effectiveAmountPerHour: round(effectiveRate),
    breachTime: round(breachTime),
    overflowed,
    itemRate: round(itemRate),
    productionRate: round(rawRate),
    capacityRate: round(capacityItemRate),
    baseMaterialPerHour: mapNumbers(normalizedBaseMaterialPerHour),
    materialPerHour: mapNumbers(
      Object.fromEntries(
        Object.entries(sourceMaterialPerHour).map(([material, rate]) => [
          material,
          Math.abs(Number(rate) || 0),
        ]),
      ),
    ),
    effectiveMaterialPerHour:
      Object.keys(effectiveMaterialPerHour).length > 0
        ? mapNumbers(effectiveMaterialPerHour)
        : undefined,
    orders: normalizedOrders(production.orders),
  };
}

function aggregateOldProductionResults(facilities, schedule) {
  const totals = {};
  facilities.forEach((plan) => {
    const duration = Number(schedule.queues[plan.queue]?.interval) || 12;
    Object.values(plan.facilities).forEach((facility) => {
      const production = facility.production;
      if (!production) return;
      const product = canonicalProduct(production.product);
      const current = (totals[product] ??= {
        product,
        nominal: 0,
        effective: 0,
      });
      const unitFactor = productionUnitFactor(String(production.product ?? ""));
      const rate = (Number(production.amountPerHour) || 0) * unitFactor;
      current.nominal += rate * duration;
      current.effective +=
        (Number(production.effectiveAmountPerHour) ||
          Number(production.amountPerHour) ||
          0) *
        unitFactor *
        duration;
    });
  });
  const totalDuration = schedule.queues.reduce(
    (total, queue) => total + (Number(queue.interval) || 12),
    0,
  );
  return Object.fromEntries(
    Object.entries(totals).map(([product, value]) => [
      product,
      {
        product,
        amountPerDay: round((value.nominal * 24) / totalDuration),
        effectiveAmountPerDay: round((value.effective * 24) / totalDuration),
      },
    ]),
  );
}

function aggregateOldConsumptionResults(facilities, schedule) {
  const totals = {};
  facilities.forEach((plan) => {
    const duration = Number(schedule.queues[plan.queue]?.interval) || 12;
    Object.values(plan.facilities).forEach((facility) => {
      Object.entries(facility.production?.materialPerHour ?? {}).forEach(
        ([material, rate]) => {
          const key = canonicalProduct(material);
          const current = (totals[key] ??= { nominal: 0, effective: 0 });
          current.nominal += Math.abs(Number(rate) || 0) * duration;
        },
      );
      Object.entries(
        facility.production?.effectiveMaterialPerHour ??
          facility.production?.materialPerHour ??
          {},
      ).forEach(([material, rate]) => {
        const key = canonicalProduct(material);
        const current = (totals[key] ??= { nominal: 0, effective: 0 });
        current.effective += Math.abs(Number(rate) || 0) * duration;
      });
    });
  });
  const totalDuration = schedule.queues.reduce(
    (total, queue) => total + (Number(queue.interval) || 12),
    0,
  );
  return Object.fromEntries(
    Object.entries(totals).map(([material, value]) => [
      material,
      {
        material,
        nominalAmountPerDay: round((value.nominal * 24) / totalDuration),
        amountPerDay: round((value.effective * 24) / totalDuration),
      },
    ]),
  );
}

function newConsumptionResults(plans) {
  const totals = {};
  plans.forEach((plan) => {
    const duration = Number(plan.durationHours) || 0;
    Object.values(plan.facilities).forEach((facility) => {
      const production = facility.production;
      if (!production) return;
      Object.entries(production.materialPerHour ?? {}).forEach(
        ([material, rate]) => {
          const key = canonicalProduct(material);
          totals[key] = totals[key] ?? { nominal: 0, effective: 0 };
          totals[key].nominal += Math.abs(Number(rate) || 0) * duration;
        },
      );
      Object.entries(
        production.effectiveMaterialPerHour ?? production.materialPerHour ?? {},
      ).forEach(([material, rate]) => {
        const key = canonicalProduct(material);
        totals[key] = totals[key] ?? { nominal: 0, effective: 0 };
        totals[key].effective += Math.abs(Number(rate) || 0) * duration;
      });
    });
  });
  const totalDuration = plans.reduce(
    (total, plan) => total + (Number(plan.durationHours) || 0),
    0,
  );
  return Object.fromEntries(
    Object.entries(totals).map(([material, value]) => [
      material,
      {
        material,
        nominalAmountPerDay: round(
          totalDuration > 0 ? (value.nominal * 24) / totalDuration : 0,
        ),
        amountPerDay: round(
          totalDuration > 0 ? (value.effective * 24) / totalDuration : 0,
        ),
      },
    ]),
  );
}

function newFacilityResults(result, scenario) {
  return result.plans.map((plan) => ({
    durationHours: round(plan.durationHours),
    moods: Object.fromEntries(
      plan.moods
        .filter((mood) => mood.facility !== "dormitory")
        .map((mood) => [`${mood.operator}@${mood.facility}`, mapNumbers(mood)]),
    ),
    basePoints: mapNumbers(plan.basePoints),
    facilities: Object.fromEntries(
      plan.facilities.map((facility) => {
        const key = `${facility.facility.type}-${facility.facility.index + 1}`;
        return [
          key,
          {
            id: key,
            type: facility.facility.type,
            index: facility.facility.index,
            level: facility.facility.level,
            baseEfficiency: round(facility.baseEfficiency),
            moodEfficiency: round(facility.moodEfficiency),
            operatorEfficiency: round(facility.operatorEfficiency),
            skillEfficiency: round(facility.skillEfficiency),
            combinationEfficiency: round(facility.combinationEfficiency),
            efficiency: round(facility.efficiency),
            attributes: normalizedAttributes(
              facility.facility.type,
              facility.attributes,
            ),
            capacity: normalizedCapacity(
              facility.capacity,
              facility.facility.type,
            ),
            production: normalizedProduction(
              facility.production,
              facility.facility.type,
              plan.durationHours,
              settingsOf(scenario),
              facility.capacity,
            ),
            details: mapNumbers(facility.details),
            baseDetails: mapNumbers(facility.baseDetails),
            combinationDetails: mapNumbers(facility.combinationDetails),
            moodDetails: mapNumbers(facility.moodDetails),
            operatorContributions: mapNumbers(facility.operatorContributions),
          },
        ];
      }),
    ),
    warnings: plan.warnings,
  }));
}

function oldMoodResults(runtime, schedule) {
  return schedule.queues.map((queue, queueIndex) => {
    const moods = [];
    schedule.layout.facilities.forEach((facility) => {
      const assignments = queue.assignments[facility.id] ?? [];
      assignments.forEach((operator, slotIndex) => {
        if (!operator?.name) return;
        if (facility.type === "dorm") return;
        moods.push({
          key: `${operator.name}@${OLD_TO_NEW_ROOM[facility.type] ?? facility.type}`,
          value: {
            operator: operator.name,
            facility: OLD_TO_NEW_ROOM[facility.type] ?? facility.type,
            start: round(
              runtime.SimMood.moodAt(
                schedule,
                facility,
                queue,
                operator,
                slotIndex,
              ),
            ),
            end: round(
              runtime.SimMood.moodRemain(
                schedule,
                facility,
                queue,
                operator,
                slotIndex,
              ),
            ),
            costRate: round(
              runtime.SimMood.moodCostRate(schedule, facility, queue, operator),
            ),
            working: runtime.SimMood.isWorking(operator),
          },
        });
      });
    });
    return {
      queue: queueIndex,
      moods: Object.fromEntries(moods.map((item) => [item.key, item.value])),
    };
  });
}

function oldFacilityResults(runtime, schedule) {
  runtime.SimDorm.invalidate();
  runtime.SimDorm.plan(schedule);
  const runtimeSettings = runtime.SimSettings.get();
  const settings = {
    firstItemProgress: runtimeSettings.firstProductProgress ?? 0,
    overflowMode: runtimeSettings.overflowZeroEff ? "zero" : "continue",
  };
  const durationHours = Number(schedule.queues[0]?.interval) || 12;
  return schedule.queues.map((queue, queueIndex) => {
    const facilities = [];
    const powerFacilities = schedule.layout.facilities.filter(
      (facility) => facility.type === "power",
    );
    schedule.layout.facilities.forEach((facility) => {
      if (
        ["ctrl", "power", "workshop", "train", "dorm"].includes(facility.type)
      )
        return;
      const assignments = queue.assignments[facility.id] ?? [];
      if (!assignments.some((operator) => operator?.name)) return;
      const efficiency = runtime.SimCalc.calcEfficiency(
        schedule,
        facility,
        queue,
      );
      const skill = runtime.SimSkills.skillBonusOf(
        schedule,
        [facility],
        queue,
        facility.type === "manu" || facility.type === "trade"
          ? { matchProduct: facility.productType }
          : null,
      );
      const production = runtime.SimProd.productionFor(
        schedule,
        facility,
        queue,
      );
      facilities.push({
        id: `${facility.type}-${facility.index}`,
        type: OLD_TO_NEW_ROOM[facility.type] ?? facility.type,
        index: facility.index - 1,
        level: facility.level,
        baseEfficiency:
          facility.type === "reception"
            ? (runtime.SimData.RECEPTION_BASE[facility.level] ?? 107)
            : 100,
        efficiency: round(efficiency),
        operatorEfficiency: round(
          runtime.SimCalc.opMoodEff(
            schedule,
            facility,
            queue,
            facility.type === "trade" || facility.type === "manu" ? 1 : 5,
          ),
        ),
        skillEfficiency: round(skill.total),
        combinationEfficiency: round(skill.total),
        skillTotal: round(skill.total),
        facBase: round(skill.facBase),
        attributes: normalizedAttributes(
          OLD_TO_NEW_ROOM[facility.type] ?? facility.type,
          skill.attrs,
        ),
        capacity: normalizedCapacity(
          production?.capacity,
          OLD_TO_NEW_ROOM[facility.type] ?? facility.type,
        ),
        production: normalizedProduction(
          production,
          OLD_TO_NEW_ROOM[facility.type] ?? facility.type,
          durationHours,
          settings,
        ),
      });
    });
    const activePowerFacilities = powerFacilities.filter((facility) =>
      (queue.assignments[facility.id] ?? []).some((operator) => operator?.name),
    );
    if (activePowerFacilities.length > 0) {
      const production = runtime.SimProdPower.powerStationProduction(
        schedule,
        activePowerFacilities,
        queue,
      );
      const skill = runtime.SimSkills.skillBonusOf(
        schedule,
        activePowerFacilities,
        queue,
        null,
      );
      const moodEfficiency = activePowerFacilities.reduce(
        (total, facility) =>
          total + runtime.SimCalc.opMoodEff(schedule, facility, queue, 5),
        0,
      );
      facilities.push({
        id: "power-1",
        type: "power",
        index: 0,
        level: activePowerFacilities[0].level,
        baseEfficiency: 100,
        efficiency: round(production?.efficiency),
        operatorEfficiency: round(moodEfficiency),
        skillEfficiency: round(skill.total),
        combinationEfficiency: round(skill.total),
        skillTotal: round(skill.total),
        facBase: round(skill.facBase),
        attributes: {},
        capacity: normalizedCapacity(production?.capacity, "power"),
        production: normalizedProduction(
          production,
          "power",
          durationHours,
          settings,
        ),
      });
    }
    return {
      queue: queueIndex,
      facilities: Object.fromEntries(
        facilities.map((facility) => [
          `${facility.type}-${facility.index + 1}`,
          facility,
        ]),
      ),
    };
  });
}

function oldBasePointsResults(runtime, schedule) {
  return schedule.queues.map((queue) =>
    mapNumbers(
      runtime.SimEffAggregate.computeBasePoints(schedule, queue).points,
    ),
  );
}

function oldResults(runtime, schedule) {
  const facilities = oldFacilityResults(runtime, schedule);
  return {
    plans: facilities.map((item, index) => ({
      ...item,
      moods: oldMoodResults(runtime, schedule)[index]?.moods ?? {},
      basePoints: oldBasePointsResults(runtime, schedule)[index] ?? {},
    })),
    dailyProductions: aggregateOldProductionResults(facilities, schedule),
    dailyConsumptions: aggregateOldConsumptionResults(facilities, schedule),
    dailyIncome: mapNumbers(runtime.SimProd.dailyIncome(schedule)),
    power: mapNumbers(runtime.SimCalc.calcPower(schedule)),
    ambience: round(runtime.SimCalc.calcDormAmbience(schedule)),
  };
}

function semanticEfficiency(facility) {
  return round(
    Number(facility.efficiency) ||
      Number(facility.baseEfficiency) +
        Number(facility.operatorEfficiency) +
        Number(facility.skillEfficiency),
  );
}

function semanticMoods(plan) {
  return Object.fromEntries(
    Object.entries(plan.moods ?? {}).map(([key, mood]) => [
      key,
      {
        start: round(mood.start),
        end: round(mood.end),
        costRate: round(mood.costRate),
        working: mood.working,
      },
    ]),
  );
}

function semanticFacility(facility) {
  const production = facility.production;
  return {
    efficiency: semanticEfficiency(facility),
    attributes: normalizedAttributes(facility.type, facility.attributes),
    capacity: normalizedCapacity(facility.capacity, facility.type),
    production: production
      ? {
          product: production.product,
          orderRule: production.orderRule,
          baseAmountPerHour: production.baseAmountPerHour,
          amountPerHour: production.amountPerHour,
          effectiveAmountPerHour: production.effectiveAmountPerHour,
          breachTime: production.breachTime,
          overflowed: production.overflowed,
          productionRate: production.productionRate,
          capacityRate: production.capacityRate,
          baseMaterialPerHour: production.baseMaterialPerHour,
          materialPerHour: production.materialPerHour,
          effectiveMaterialPerHour: production.effectiveMaterialPerHour,
          orders: production.orders,
        }
      : undefined,
  };
}

function semanticResults(result) {
  return normalizeSemanticNumbers({
    plans: result.plans.map((plan) => ({
      moods: semanticMoods(plan),
      basePoints: plan.basePoints,
      facilities: Object.fromEntries(
        Object.entries(plan.facilities).map(([key, facility]) => [
          key,
          semanticFacility(facility),
        ]),
      ),
    })),
    dailyProductions: result.dailyProductions,
    dailyConsumptions: result.dailyConsumptions,
  });
}

function compareValues(left, right, pathName = "root", output = []) {
  if (left === undefined || right === undefined) {
    if (left !== right)
      output.push({ path: pathName, newValue: left, oldValue: right });
    return output;
  }
  if (typeof left === "number" && typeof right === "number") {
    const difference = left - right;
    if (Math.abs(difference) > 1e-7)
      output.push({
        path: pathName,
        newValue: left,
        oldValue: right,
        difference,
      });
    return output;
  }
  if (typeof left !== typeof right || (left === null) !== (right === null)) {
    output.push({ path: pathName, newValue: left, oldValue: right });
    return output;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    output.push({ path: pathName, newValue: left, oldValue: right });
    return output;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      output.push({
        path: `${pathName}.length`,
        newValue: left.length,
        oldValue: right.length,
      });
    }
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      compareValues(left[index], right[index], `${pathName}[${index}]`, output);
    }
    return output;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    keys.forEach((key) =>
      compareValues(left[key], right[key], `${pathName}.${key}`, output),
    );
    return output;
  }
  if (left !== right)
    output.push({ path: pathName, newValue: left, oldValue: right });
  return output;
}

function selectScenarios() {
  const requested = process.argv
    .slice(2)
    .filter((value) => !value.startsWith("--"));
  if (requested.length === 0) return scenarios;
  const selected = scenarios.filter((scenario) =>
    requested.includes(scenario.id),
  );
  if (selected.length !== requested.length) {
    const known = new Set(selected.map((scenario) => scenario.id));
    throw new Error(
      `未知场景：${requested.filter((id) => !known.has(id)).join("、")}`,
    );
  }
  return selected;
}

async function run() {
  const selectedScenarios = selectScenarios();
  const newRuntime = await loadNewRuntime();
  const oldRuntime = await loadOldRuntime();
  const output = [];
  try {
    for (const scenario of selectedScenarios) {
      oldRuntime.setScenarioSettings(scenario);
      const names = scenarioOperatorNames(scenario);
      const missingOld = names.filter(
        (name) => !oldRuntime.OperatorData._index?.has(name),
      );
      const missingNew = names.filter(
        (name) => !newRuntime.catalog.operators[name],
      );
      if (missingOld.length || missingNew.length) {
        output.push({
          id: scenario.id,
          title: scenario.title,
          names,
          missingOld,
          missingNew,
        });
        continue;
      }
      await oldRuntime.SimSkills.ensureOps(names);
      const newDocument = buildNewDocument(scenario);
      const oldSchedule = buildOldSchedule(scenario, oldRuntime);
      const newResult = newRuntime.calculateEfficiency(
        newDocument,
        newRuntime.catalog,
      );
      const oldResult = oldResults(oldRuntime, oldSchedule);
      const normalizedNewPlans = newFacilityResults(newResult, scenario);
      const normalizedNew = {
        plans: normalizedNewPlans,
        dailyProductions: Object.fromEntries(
          newResult.dailyProductions.map((item) => [
            canonicalProduct(item.product),
            {
              product: canonicalProduct(item.product),
              amountPerDay: round(item.amountPerDay),
              effectiveAmountPerDay: round(
                item.effectiveAmountPerDay ?? item.amountPerDay,
              ),
            },
          ]),
        ),
        dailyConsumptions: newConsumptionResults(normalizedNewPlans),
        warnings: newResult.warnings,
      };
      output.push({
        id: scenario.id,
        title: scenario.title,
        operators: names,
        input: { newDocument, oldSchedule },
        new: normalizedNew,
        old: oldResult,
        differences: compareValues(
          semanticResults(normalizedNew),
          semanticResults(oldResult),
        ),
        semantic: {
          new: semanticResults(normalizedNew),
          old: semanticResults(oldResult),
        },
      });
    }
  } finally {
    await newRuntime.close();
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
