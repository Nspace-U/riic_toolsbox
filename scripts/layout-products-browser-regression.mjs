import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const browser = await chromium.launch({
  executablePath:
    process.env.RIIC_TEST_BROWSER ??
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const baseUrl = process.env.RIIC_TEST_URL ?? "http://127.0.0.1:5174";
try {
  const page = await browser.newPage({
    viewport: { width: 1360, height: 1100 },
  });
  await page.goto(`${baseUrl}/simulator`);
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "新建排班表" }).click();
  await page.waitForTimeout(500);
  await page.getByLabel("选择预设布局").click();
  await page.locator('.ant-select-item-option[title="243"]').click();
  await page.getByRole("button", { name: /应\s*用/ }).click();
  await page.waitForTimeout(500);
  const cards = await page.locator(".simulator-layout-card").allInnerTexts();
  assert.deepEqual(
    cards.slice(3, 7).map((text) => text.split("\n").at(-1)),
    ["赤金", "赤金", "中级作战记录", "中级作战记录"],
  );
  for (const [name, tradingIndex] of [
    ["243 搓玉", 2],
    ["右满342 搓玉", 3],
  ]) {
    await page.getByLabel("选择预设布局").click();
    await page.locator(`.ant-select-item-option[title="${name}"]`).click();
    await page.getByRole("button", { name: /应\s*用/ }).click();
    assert.match(
      await page.getByLabel(`贸易站 ${tradingIndex} 产物`).innerText(),
      /合成玉/,
    );
    assert.match(
      await page.getByLabel("制造站 4 产物").innerText(),
      /源石碎片/,
    );
    assert.match(await page.getByLabel("制造站 4 材料").innerText(), /固源岩/);
    if (tradingIndex === 3) {
      const levels = await Promise.all(
        [1, 2, 3].map((index) =>
          page
            .getByLabel(`贸易站 ${index} 产物`)
            .locator("..")
            .locator(".ant-input-number-input")
            .inputValue(),
        ),
      );
      assert.deepEqual(levels, ["3", "1", "3"]);
    }
  }
  await page.getByLabel("选择预设布局").click();
  await page.locator('.ant-select-item-option[title="243"]').click();
  await page.getByRole("button", { name: /应\s*用/ }).click();
  await page.getByLabel("制造站 1 产物").click();
  await page.locator('.ant-select-item-option[title="源石碎片"]').click();
  assert.match(await page.getByLabel("制造站 1 材料").innerText(), /固源岩/);
  await page.getByLabel("制造站 1 材料").click();
  await page.locator('.ant-select-item-option[title="装置"]').click();
  await page.reload();
  assert.match(await page.getByLabel("制造站 1 材料").innerText(), /装置/);
  const imported = {
    layout: [
      { type: "control", level: 5 },
      { type: "manufacture", level: 3 },
    ],
    plans: [
      { rooms: { control: [{}], manufacture: [{ product: "Pure Gold" }] } },
      { rooms: { control: [{}], manufacture: [{ product: "Battle Record" }] } },
    ],
  };
  await page.locator('input[type="file"]').setInputFiles({
    name: "plans.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  const importDialog = page.getByRole("dialog");
  await importDialog.waitFor();
  assert.match(
    await importDialog.getByLabel("制造站 1 产物").innerText(),
    /多个产物/,
  );
  await importDialog.getByLabel("制造站 1 产物").click();
  await page.locator('.ant-select-item-option[title="源石碎片"]').click();
  await importDialog.getByLabel("制造站 1 材料").click();
  await page.locator('.ant-select-item-option[title="装置"]').click();
  await importDialog.getByRole("button", { name: "确认导入" }).click();
  const importedRooms = await page.evaluate(() => {
    const docs = JSON.parse(
      localStorage.getItem("riic-tools:schedule-documents:v1"),
    );
    const active = localStorage.getItem(
      "riic-tools:schedule-active-document:v1",
    );
    return docs
      .find((doc) => doc.id === active)
      .document.plans.map((plan) => plan.rooms.manufacture[0]);
  });
  assert.ok(
    importedRooms.every(
      (room) => room.product === "源石碎片" && room.sourceMaterial === "装置",
    ),
  );
  await page.goto(`${baseUrl}/calculators/ranking`);
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "编辑布局" }).click();
  await page.getByLabel("制造站 1 产物").click();
  await page.locator('.ant-select-item-option[title="源石碎片"]').click();
  await page.getByLabel("制造站 1 材料").click();
  await page.locator('.ant-select-item-option[title="装置"]').click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /保\s*存/ })
    .click();
  await page.getByRole("button", { name: "编辑排班" }).first().click();
  assert.match(
    await page.getByLabel("制造站 1 产物").innerText(),
    /使用共享默认产物/,
  );
  assert.match(await page.getByLabel("制造站 1 材料").innerText(), /装置/);
  await page.getByLabel("制造站 1 材料").click();
  await page.locator('.ant-select-item-option[title="固源岩"]').click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /保\s*存/ })
    .click();
  await page.getByRole("button", { name: "编辑排班" }).first().click();
  assert.match(
    await page.getByLabel("制造站 1 产物").innerText(),
    /使用共享默认产物/,
  );
  assert.match(await page.getByLabel("制造站 1 材料").innerText(), /固源岩/);
  await page.getByLabel("制造站 1 产物").click();
  await page
    .locator('.ant-select-item-option[title="使用共享默认产物"]')
    .click();
  assert.match(await page.getByLabel("制造站 1 材料").innerText(), /装置/);
  await page.goto(`${baseUrl}/calculators/combination`);
  await page.waitForTimeout(3000);
  await page.getByText("红云组", { exact: true }).click();
  await page.getByRole("button", { name: "编辑行" }).first().click();
  await page.getByLabel("制造站 1 产物").click();
  await page.locator('.ant-select-item-option[title="使用组默认产物"]').click();
  assert.match(
    await page.getByLabel("制造站 1 产物").innerText(),
    /使用组默认产物/,
  );
  await page.getByLabel("制造站 1 产物").click();
  await page.locator('.ant-select-item-option[title="源石碎片"]').click();
  assert.match(await page.getByLabel("制造站 1 材料").innerText(), /固源岩/);
  await page.setViewportSize({ width: 390, height: 844 });
  const fits = await page.getByLabel("制造站 1 产物").evaluate((node) => {
    const card = node.closest(".simulator-layout-card").getBoundingClientRect();
    const select = node.getBoundingClientRect();
    return select.left >= card.left && select.right <= card.right;
  });
  assert.ok(fits);
  console.log("PASS 浏览器预设、导入草稿、计算器和效率排名产物设置");
} finally {
  await browser.close();
}
