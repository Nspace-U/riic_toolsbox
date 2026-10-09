import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

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

function extractMaterialValues(exportedItems, itemIds) {
  const requiredIds = new Set(itemIds);
  const values = new Map();
  if (!Array.isArray(exportedItems)) {
    throw new Error("一图流导出的 JSON 格式无效");
  }
  for (const item of exportedItems) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const itemId = String(item.id ?? item.itemId ?? "");
    if (!requiredIds.has(itemId)) {
      continue;
    }
    const sanity = Number(item.apValue);
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

async function fetchDisplayedMaterialValues(itemIds) {
  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
  });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(YITULIU_URL, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.locator(".item-value-cell").first().waitFor({
      state: "visible",
      timeout: 90000,
    });
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page.getByRole("button", { name: /导出\s*JSON/i }).click(),
    ]);
    const downloadPath = await download.path();
    if (!downloadPath) {
      throw new Error("一图流 JSON 导出文件不可读取");
    }
    const exportedItems = JSON.parse(await readFile(downloadPath, "utf8"));
    return extractMaterialValues(exportedItems, itemIds);
  } finally {
    await browser.close();
  }
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

  const values = await fetchDisplayedMaterialValues(itemIds);
  const output = {
    source: YITULIU_URL,
    field: "apValue",
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
