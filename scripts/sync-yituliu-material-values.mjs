import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const YITULIU_URL = "https://ark.yituliu.cn/material/value";
const ITEM_TABLE_PATH = "public/assets/gamedata/latest/excel/item_table.json";
const OUTPUT_PATH = "public/assets/sanity-material-defaults.json";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function isSanityMaterialItem(item) {
  return (
    item.itemType === "MATERIAL" &&
    item.classifyType === "MATERIAL" &&
    item.sortId >= 100001 &&
    item.sortId <= 100060
  );
}

async function fetchText(url, label) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    throw new Error(`${label}读取失败（HTTP ${response.status}）`);
  }
  return response.text();
}

function pageModuleUrl(html) {
  for (const [, attributes] of html.matchAll(/<script\b([^>]*)>/gi)) {
    if (!/\btype=["']module["']/i.test(attributes)) {
      continue;
    }
    const source = attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (!source) {
      continue;
    }
    const url = new URL(source, YITULIU_URL);
    if (url.origin !== new URL(YITULIU_URL).origin) {
      throw new Error("一图流价值表模块地址不是同源地址");
    }
    return url;
  }
  throw new Error("没有找到一图流价值表模块脚本");
}

function extractMaterialValues(bundle, itemIds) {
  const requiredIds = new Set(itemIds);
  const values = new Map();
  const records =
    /\{itemId:"([^"]+)",itemName:"(?:\\.|[^"])*",itemValue:[^,]+,itemValueAp:([^,]+),rarity:(\d+),/g;
  for (const match of bundle.matchAll(records)) {
    const [, itemId, rawSanity] = match;
    if (!requiredIds.has(itemId)) {
      continue;
    }
    const sanity = Number(rawSanity);
    if (!Number.isFinite(sanity) || sanity < 0) {
      throw new Error(`一图流物品 ${itemId} 的理智值无效`);
    }
    const previous = values.get(itemId);
    if (previous !== undefined && previous !== sanity) {
      throw new Error(`一图流物品 ${itemId} 出现冲突的理智值`);
    }
    values.set(itemId, sanity);
  }
  if (values.size === 0) {
    throw new Error("没有从一图流页面模块中读取到材料理智值");
  }
  return Object.fromEntries(
    [...values].sort(([left], [right]) => Number(left) - Number(right)),
  );
}

async function main() {
  const itemTable = JSON.parse(
    await readFile(resolve(projectRoot, ITEM_TABLE_PATH), "utf8"),
  );
  const itemIds = Object.values(itemTable.items ?? {})
    .filter(isSanityMaterialItem)
    .map((item) => item.itemId);
  if (itemIds.length === 0) {
    throw new Error("Torappu 本地快照中没有筛选到材料道具");
  }

  const html = await fetchText(YITULIU_URL, "一图流价值表页面");
  const moduleUrl = pageModuleUrl(html);
  const bundle = await fetchText(moduleUrl, "一图流价值表数据");
  const values = extractMaterialValues(bundle, itemIds);
  const output = {
    source: YITULIU_URL,
    field: "itemValueAp",
    capturedAt: new Date().toISOString().slice(0, 10),
    values,
  };
  const outputPath = resolve(projectRoot, OUTPUT_PATH);
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(output, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }

  console.log(
    `一图流材料理智默认值已同步：${Object.keys(values).length}/${itemIds.length}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
