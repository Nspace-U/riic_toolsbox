import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      (process.platform === "win32"
        ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
        : undefined),
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.addInitScript(() => {
    const document = {
      title: "有效映射",
      layout: [
        { type: "control", level: 5 },
        { type: "manufacture", level: 3 },
      ],
      plans: [
        {
          name: "队列1",
          duration: 720,
          rooms: {
            control: [{ operators: ["精英干员"] }],
            manufacture: [
              {
                operators: ["35%"],
                operatorStates: { "35%": { mood: 12, elite: 0 } },
                product: "中级作战记录",
              },
            ],
          },
        },
      ],
    };
    const docs = [
      { id: "valid", document },
      {
        id: "invalid",
        document: {
          ...document,
          title: "失败映射",
          plans: [
            {
              ...document.plans[0],
              rooms: { manufacture: [{ operators: ["999%"] }] },
            },
          ],
        },
      },
      {
        id: "fiammetta",
        document: {
          ...document,
          title: "特殊目标",
          fiammetta: { direct: { operators: ["精英干员"] } },
        },
      },
    ].map((item) => ({
      ...item,
      inferredLayout: false,
      sourceFileName: "",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    }));
    localStorage.setItem(
      "riic-tools:schedule-documents:v1",
      JSON.stringify(docs),
    );
    localStorage.setItem("riic-tools:schedule-active-document:v1", "valid");
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  await page.goto(`http://127.0.0.1:${address.port}/simulator`);
  const editor = page.locator(".simulator-editor");
  const toggle = editor.getByRole("checkbox", { name: "映射特殊干员" });
  await editor.getByText("35%", { exact: true }).first().waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector(".simulator-efficiency-panel .ant-alert-info"),
  );
  const efficiency = editor.locator(
    '[data-facility-type="manufacture"] .simulator-efficiency-summary-line--total',
  );
  const originalEfficiency = await efficiency.innerText();
  const storedBefore = await page.evaluate(() =>
    localStorage.getItem("riic-tools:schedule-documents:v1"),
  );
  await toggle.check();
  await editor.getByText("断罪者", { exact: true }).first().waitFor();
  assert.notEqual(await efficiency.innerText(), originalEfficiency);
  assert.equal(await editor.getByText("35%", { exact: true }).count(), 0);
  assert.equal(await page.locator("#simulator-meta-title").isDisabled(), true);
  assert.equal(
    await editor.getByRole("checkbox", { name: "编辑布局" }).isDisabled(),
    true,
  );
  assert.equal(
    await editor.getByRole("checkbox", { name: "编辑队列" }).isDisabled(),
    true,
  );
  assert.equal(
    await editor.getByRole("button", { name: "计算设置" }).isDisabled(),
    true,
  );
  assert.equal(
    await editor.locator(".simulator-layout-panel").getAttribute("inert"),
    "",
  );
  await editor.getByText("断罪者", { exact: true }).first().dblclick();
  assert.equal(await editor.locator(".simulator-slot-name-input").count(), 0);
  await page.keyboard.press("Control+z");
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("riic-tools:schedule-documents:v1"),
    ),
    storedBefore,
  );

  await page
    .locator('[data-schedule-document-id="valid"]')
    .click({ button: "right" });
  await page.getByText("导出预览", { exact: true }).click();
  const modal = page.getByRole("dialog", { name: "排班表图片预览" });
  const imageToggle = modal.getByRole("checkbox", { name: "映射特殊干员" });
  await modal.getByText("断罪者", { exact: true }).first().waitFor();
  await imageToggle.uncheck();
  await modal.getByText("35%", { exact: true }).first().waitFor();
  assert.ok(
    (await modal.locator(".operator-avatar-special-label").count()) >= 2,
  );
  await imageToggle.check();
  await modal.getByText("断罪者", { exact: true }).first().waitFor();
  await modal.getByRole("button", { name: "Close" }).click();
  await toggle.uncheck();
  await editor.getByText("35%", { exact: true }).first().waitFor();
  assert.equal(await page.locator("#simulator-meta-title").isDisabled(), false);

  await toggle.check();
  await page.locator('[data-schedule-document-id="invalid"]').click();
  assert.equal(await toggle.isChecked(), false);
  await toggle.check({ force: true }).catch(() => {});
  await page
    .getByText(/没有配置映射/)
    .first()
    .waitFor();
  assert.equal(await toggle.isChecked(), false);
  await page.locator('[data-schedule-document-id="fiammetta"]').click();
  await toggle.check({ force: true }).catch(() => {});
  await page.getByText(/菲亚梅塔互换目标包含特殊干员/).waitFor();
  assert.equal(await toggle.isChecked(), false);
  await page.locator('[data-schedule-document-id="valid"]').click();
  const queueName = editor.locator(".simulator-queue-entry-title").first();
  await queueName.fill("修改后的队列");
  await toggle.check();
  await page.keyboard.press("Control+z");
  await toggle.uncheck();
  assert.equal(await queueName.inputValue(), "修改后的队列");
  assert.equal(
    await toggle.evaluate((input) => input === document.activeElement),
    true,
  );
  await page.keyboard.press("Control+z");
  assert.equal(await queueName.inputValue(), "队列1");
  await page.keyboard.press("Control+y");
  assert.equal(await queueName.inputValue(), "修改后的队列");
  await toggle.check();
  await page.reload();
  await editor.getByText("35%", { exact: true }).first().waitFor();
  assert.equal(await toggle.isChecked(), false);
  console.log("Simulator special operator mapping regression passed");
} finally {
  await browser?.close();
  await server.close();
}
