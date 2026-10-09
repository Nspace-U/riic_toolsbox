import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TORAPPU_URL = "https://torappu.prts.wiki";
const SOURCE_URL = `${TORAPPU_URL}/diff`;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicAssetsRoot = resolve(projectRoot, "public/assets");

const DATA_FILES = [
  {
    name: "character_table",
    path: "gamedata/latest/excel/character_table.json",
  },
  {
    name: "building_data",
    path: "gamedata/latest/excel/building_data.json",
  },
  {
    name: "gamedata_const",
    path: "gamedata/latest/excel/gamedata_const.json",
  },
  {
    name: "item_table",
    path: "gamedata/latest/excel/item_table.json",
  },
  {
    name: "recycle_data",
    path: "gamedata/latest/excel/recycle_data.json",
    sourceOnly: true,
  },
];

const TARGET_ITEM_IDS = [
  "4001",
  "4003",
  "2003",
  "3003",
  "3141",
  "base_ap",
  "SOCIAL_PT",
  "7001",
  "30012",
  "30062",
];

function isSanityMaterialItem(item) {
  return (
    item.itemType === "MATERIAL" &&
    item.classifyType === "MATERIAL" &&
    item.sortId >= 100001 &&
    item.sortId <= 100060
  );
}

const ITEM_TABLE_PATH = "gamedata/latest/excel/item_table.json";
const ITEM_ICON_SOURCE_PATH = "assets/item_icon";
const ITEM_ICON_LOCAL_PATH = "raw/item_icon";
const SANITY_ICON_FILE = "AP_GAMEPLAY.png";
const AVATAR_METADATA_ICON_GROUPS = {
  elite: {
    sourceDirectory: "elite_icon",
    localDirectory: "elite_icon",
    fileNames: ["elite_0_large.png", "elite_1_large.png", "elite_2_large.png"],
  },
  rarity: {
    sourceDirectory: "rarity_icon",
    localDirectory: "rarity_icon",
    fileNames: [
      "rarity_yellow_0.png",
      "rarity_yellow_1.png",
      "rarity_yellow_2.png",
      "rarity_yellow_3.png",
      "rarity_yellow_4.png",
      "rarity_yellow_5.png",
    ],
  },
  profession: {
    sourceDirectory: "profession_large_icon",
    localDirectory: "profession_large_icon",
    fileNames: [
      "icon_profession_caster_large.png",
      "icon_profession_medic_large.png",
      "icon_profession_pioneer_large.png",
      "icon_profession_sniper_large.png",
      "icon_profession_special_large.png",
      "icon_profession_support_large.png",
      "icon_profession_tank_large.png",
      "icon_profession_warrior_large.png",
    ],
  },
};

async function fetchResponse(url, label) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url);
    if (response.ok || response.status === 404 || attempt === 3) {
      return response;
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, attempt * 250),
    );
  }

  throw new Error(`${label}读取失败`);
}

async function fetchJson(url, label) {
  const response = await fetchResponse(url, label);
  if (!response.ok) {
    throw new Error(`${label}读取失败（HTTP ${response.status}）`);
  }
  return response.json();
}

async function writeJson(relativePath, value) {
  const targetPath = resolve(publicAssetsRoot, relativePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function downloadAsset(directory, fileName) {
  const sourceUrl = `${TORAPPU_URL}/assets/${directory}/${encodeURIComponent(fileName)}`;
  const response = await fetchResponse(sourceUrl, `${directory}/${fileName}`);
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(
      `${directory}/${fileName}读取失败（HTTP ${response.status}）`,
    );
  }

  const content = Buffer.from(await response.arrayBuffer());
  if (content.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`${directory}/${fileName}不是有效的 PNG 文件`);
  }

  const targetPath = resolve(publicAssetsRoot, `raw/${directory}/${fileName}`);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
  return true;
}

async function runPool(items, concurrency, worker) {
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, runWorker));
}

// Keep the local snapshot limited to fields consumed by the app and asset sync.
function selectCharacterTable(
  characterTable,
  buildingCharacters,
  operatorIds,
  previousCharacterTable = {},
) {
  return Object.fromEntries(
    operatorIds.map((operatorId) => {
      const character = characterTable[operatorId];
      const buildingCharacter = buildingCharacters[operatorId];
      const implementationDate =
        previousCharacterTable[operatorId]?.implementationDate;
      const implementationOrder =
        previousCharacterTable[operatorId]?.implementationOrder;
      const branch = previousCharacterTable[operatorId]?.branch;
      return [
        operatorId,
        {
          name: character.name,
          rarity: character.rarity,
          profession: character.profession,
          subProfessionId: character.subProfessionId,
          isSpChar: character.isSpChar === true,
          phaseCount: Array.isArray(character.phases)
            ? character.phases.length
            : 0,
          buffChar: (buildingCharacter?.buffChar ?? []).map((slotData) => ({
            buffData: (slotData.buffData ?? []).map((buffData) => ({
              buffId: buffData.buffId,
              ...(buffData.cond
                ? {
                    cond: {
                      phase: buffData.cond.phase,
                      level: buffData.cond.level,
                    },
                  }
                : {}),
            })),
          })),
          ...(implementationDate ? { implementationDate } : {}),
          ...(Number.isFinite(implementationOrder)
            ? { implementationOrder }
            : {}),
          ...(branch ? { branch } : {}),
        },
      ];
    }),
  );
}

async function readExistingCharacterTable() {
  try {
    const filePath = resolve(
      publicAssetsRoot,
      "gamedata/latest/excel/character_table.json",
    );
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function selectBuildingData(buildingData, operatorIds) {
  const buffIds = new Set(
    operatorIds.flatMap((operatorId) =>
      (buildingData.chars?.[operatorId]?.buffChar ?? []).flatMap((slotData) =>
        slotData.buffData.map((buffData) => buffData.buffId).filter(Boolean),
      ),
    ),
  );
  const buffs = Object.fromEntries(
    [...buffIds].map((buffId) => {
      const buff = buildingData.buffs[buffId];
      return [
        buffId,
        {
          buffName: buff.buffName,
          skillIcon: buff.skillIcon,
          roomType: buff.roomType,
          description: buff.description,
        },
      ];
    }),
  );

  return { buffs };
}

function selectRecycleBuildingData(recycleData) {
  return Object.fromEntries(
    Object.entries(recycleData).filter(([key]) => key.startsWith("recycle")),
  );
}

function selectItemTable(itemTable) {
  const itemIds = new Set([
    ...TARGET_ITEM_IDS,
    ...Object.values(itemTable.items ?? {})
      .filter(isSanityMaterialItem)
      .map((item) => item.itemId),
  ]);
  const items = Object.fromEntries(
    [...itemIds].map((itemId) => {
      const item = itemTable.items?.[itemId];
      if (!item) {
        throw new Error(`Torappu 物品 ${itemId} 不存在`);
      }
      return [
        itemId,
        {
          ...item,
          sourceIconPath: `${ITEM_ICON_SOURCE_PATH}/${item.iconId}.png`,
          localIconPath: `${ITEM_ICON_LOCAL_PATH}/${item.iconId}.png`,
        },
      ];
    }),
  );

  return {
    sourcePath: ITEM_TABLE_PATH,
    iconSourcePath: ITEM_ICON_SOURCE_PATH,
    iconLocalPath: ITEM_ICON_LOCAL_PATH,
    items,
    expItems: {},
    potentialItems: {},
    apSupplies: {},
    resources: {
      drone: {
        itemId: items.base_ap.itemId,
        name: items.base_ap.name,
        kind: "base_resource",
        sourcePath: ITEM_TABLE_PATH,
        sourceIconPath: items.base_ap.sourceIconPath,
        localIconPath: items.base_ap.localIconPath,
      },
    },
  };
}

function avatarNames(operatorId, character) {
  const names = [`${operatorId}.png`];
  const phaseCount = character?.phaseCount ?? 0;
  if (phaseCount >= 2) {
    names.push(`${operatorId}_1+.png`);
  }
  if (phaseCount >= 3) {
    names.push(`${operatorId}_2.png`);
  }
  return names;
}

async function main() {
  const versions = await fetchJson(
    `${TORAPPU_URL}/api/v1/version`,
    "Torappu 版本列表",
  );
  const latest = versions
    .filter(
      (version) => version.isReady && version.assetMappingStatus === "ready",
    )
    .at(-1);
  if (!latest) {
    throw new Error("Torappu 没有可用的已完成版本");
  }

  const rawData = {};
  for (const dataFile of DATA_FILES) {
    rawData[dataFile.name] = await fetchJson(
      `${TORAPPU_URL}/${dataFile.path}`,
      `Torappu ${dataFile.name}`,
    );
  }

  const previousCharacterTable = await readExistingCharacterTable();

  const operatorIds = Object.keys(rawData.building_data.chars ?? {}).filter(
    (operatorId) =>
      operatorId.startsWith("char_") &&
      rawData.character_table[operatorId]?.name,
  );
  const data = {
    character_table: selectCharacterTable(
      rawData.character_table,
      rawData.building_data.chars ?? {},
      operatorIds,
      previousCharacterTable,
    ),
    building_data: {
      ...selectBuildingData(rawData.building_data, operatorIds),
      ...selectRecycleBuildingData(rawData.recycle_data),
    },
    gamedata_const: rawData.gamedata_const,
    item_table: selectItemTable(rawData.item_table),
  };
  for (const dataFile of DATA_FILES) {
    if (dataFile.sourceOnly) continue;
    await writeJson(dataFile.path, data[dataFile.name]);
  }

  const characterTable = data.character_table;
  const buildingData = data.building_data;
  const itemTable = data.item_table;
  const skillIcons = new Set(
    [
      ...Object.values(buildingData.buffs ?? {}),
      ...Object.values(buildingData.recycleBuffs ?? {}),
    ]
      .map((buff) => buff.skillIcon)
      .filter(Boolean)
      .map((icon) => `${icon}.png`),
  );
  const avatarTasks = operatorIds.flatMap((operatorId) =>
    avatarNames(operatorId, characterTable[operatorId]).map((fileName) => ({
      directory: "char_avatar",
      fileName,
    })),
  );
  const iconTasks = [...skillIcons].map((fileName) => ({
    directory: "build_skill_icon",
    fileName,
  }));
  const itemIcons = new Set(
    Object.values(itemTable.items ?? {})
      .map((item) => item.iconId)
      .filter(Boolean),
  );
  const itemIconTasks = [...itemIcons].map((fileName) => ({
    directory: "item_icon",
    fileName: `${fileName}.png`,
  }));
  const supplementalItemIconTasks = [
    { directory: "item_icon", fileName: SANITY_ICON_FILE },
  ];
  const avatarMetadataIconTasks = Object.values(
    AVATAR_METADATA_ICON_GROUPS,
  ).flatMap(({ sourceDirectory, localDirectory, fileNames }) =>
    fileNames.map((fileName) => ({
      directory: sourceDirectory,
      localDirectory,
      fileName,
    })),
  );
  const missingAvatars = [];
  const missingItemIcons = [];
  const missingAvatarMetadataIcons = [];
  let completed = 0;
  const imageTasks = [
    ...avatarTasks,
    ...iconTasks,
    ...itemIconTasks,
    ...supplementalItemIconTasks,
    ...avatarMetadataIconTasks,
  ];
  await runPool(imageTasks, 12, async (task) => {
    const downloaded = await downloadAsset(task.directory, task.fileName);
    if (!downloaded && task.directory === "char_avatar") {
      missingAvatars.push(task.fileName);
    }
    if (!downloaded && task.directory === "item_icon") {
      missingItemIcons.push(task.fileName);
    }
    if (!downloaded && task.localDirectory) {
      missingAvatarMetadataIcons.push(
        `${task.localDirectory}/${task.fileName}`,
      );
    }
    completed += 1;
    if (completed % 100 === 0 || completed === imageTasks.length) {
      console.log(`资源同步进度：${completed}/${imageTasks.length}`);
    }
  });
  missingAvatars.sort();
  missingItemIcons.sort();
  missingAvatarMetadataIcons.sort();
  if (missingAvatarMetadataIcons.length > 0) {
    throw new Error(
      `Torappu 头像元数据图标缺失：${missingAvatarMetadataIcons.join(", ")}`,
    );
  }

  await writeJson("gamedata/latest/torappu-meta.json", {
    source: "Torappu",
    sourceUrl: SOURCE_URL,
    versionId: latest.id,
    clientVersion: latest.clientVersion,
    resVersion: latest.resVersion,
    syncedAt: new Date().toISOString(),
    missingAvatars,
    missingItemIcons,
    paths: {
      characterTable: "gamedata/latest/excel/character_table.json",
      buildingData: "gamedata/latest/excel/building_data.json",
      gamedataConst: "gamedata/latest/excel/gamedata_const.json",
      itemTable: ITEM_TABLE_PATH,
      avatars: "raw/char_avatar",
      skillIcons: "raw/build_skill_icon",
      itemIcons: ITEM_ICON_LOCAL_PATH,
      avatarMetadataIcons: Object.fromEntries(
        Object.entries(AVATAR_METADATA_ICON_GROUPS).map(
          ([key, { sourceDirectory, localDirectory }]) => [
            key,
            {
              sourcePath: `assets/${sourceDirectory}`,
              localPath: `raw/${localDirectory}`,
            },
          ],
        ),
      ),
    },
  });

  console.log(
    `Torappu 同步完成：${latest.clientVersion} / ${latest.resVersion}`,
  );
  console.log(
    `干员：${operatorIds.length}，基建图标：${skillIcons.size}，物品：${Object.keys(itemTable.items).length}，物品图标：${itemIcons.size}`,
  );
  console.log(
    `缺失阶段头像：${missingAvatars.length}，缺失物品图标：${missingItemIcons.length}`,
  );
  if (missingAvatars.length > 0) {
    console.log(`缺失头像：${missingAvatars.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
