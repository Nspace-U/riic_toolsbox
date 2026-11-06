import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const browser = await chromium
  .launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      (process.platform === "win32"
        ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
        : undefined),
    headless: true,
  })
  .catch(async (error) => {
    await server.close();
    throw error;
  });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.addInitScript(() => {
    const base = {
      title: "测试排班",
      layout: [{ type: "control", level: 5 }],
      plans: [
        {
          name: "队列1",
          duration: 720,
          rooms: { control: [{ operators: ["阿米娅", "精英干员"] }] },
        },
      ],
    };
    const docs = ["one", "two"].map((id) => ({
      id,
      document:
        id === "one"
          ? { ...base, title: id }
          : {
              ...base,
              title: id,
              layout: [...base.layout, { type: "manufacture", level: 3 }],
              plans: [
                {
                  ...base.plans[0],
                  rooms: {
                    ...base.plans[0].rooms,
                    manufacture: [{ operators: ["999%"], product: "赤金" }],
                  },
                },
              ],
            },
      inferredLayout: false,
      sourceFileName: "",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    }));
    localStorage.setItem(
      "riic-tools:schedule-documents:v1",
      JSON.stringify(docs),
    );
    localStorage.setItem("riic-tools:schedule-active-document:v1", "one");
  });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  await page.goto(`http://127.0.0.1:${address.port}/simulator`);
  await page.getByText("阿米娅", { exact: true }).first().waitFor();
  await page.getByText("排班表参考", { exact: true }).first().click();
  await page.getByText(/没有配置映射/).waitFor();
  assert.equal(
    await page.getByRole("checkbox", { name: "显示剩余心情" }).isChecked(),
    false,
  );
  assert.equal(
    await page.getByRole("checkbox", { name: "映射特殊干员" }).isChecked(),
    true,
  );
  assert.match(
    await page.locator(".schedule-reference-card").nth(1).innerText(),
    /没有配置映射/,
  );
  await page.getByRole("checkbox", { name: "映射特殊干员" }).uncheck();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        ".schedule-reference-card .operator-avatar-special-label",
      ).length === 3,
  );
  assert.equal(
    await page
      .locator(".schedule-reference-card .operator-avatar-special-label")
      .count(),
    3,
  );
  await page.getByRole("checkbox", { name: "显示剩余心情" }).check();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        ".schedule-reference-card .operator-avatar-mood-remaining",
      ).length >= 2,
  );
  assert.ok(
    (await page
      .locator(".schedule-reference-card .operator-avatar-mood-remaining")
      .count()) >= 2,
  );
  await page.getByText("排班模拟器", { exact: true }).first().click();
  await page.waitForURL("**/simulator");
  await page
    .locator(
      '.simulator-page:not(.simulator-page--preview-source) [data-schedule-document-id="one"]',
    )
    .click({ button: "right" });
  await page.getByText("导出预览", { exact: true }).click();
  const modal = page.getByRole("dialog", { name: "排班表图片预览" });
  await modal.locator(".operator-avatar-special-label").waitFor();
  assert.equal(
    await modal.getByRole("checkbox", { name: "映射特殊干员" }).isChecked(),
    false,
  );
  assert.equal(
    await modal.getByRole("checkbox", { name: "显示剩余心情" }).isChecked(),
    true,
  );
  assert.ok(
    (await modal.locator(".operator-avatar-mood-remaining").count()) > 0,
  );
  await modal.getByRole("checkbox", { name: "显示剩余心情" }).uncheck();
  await modal.locator(".operator-avatar-mood-remaining").first().waitFor({
    state: "hidden",
  });
  assert.equal(
    await modal.locator(".operator-avatar-mood-remaining").count(),
    0,
  );
  await modal.getByRole("checkbox", { name: "映射特殊干员" }).check();
  await modal
    .locator(".operator-avatar-display-name", { hasText: "迷迭香" })
    .waitFor();
  assert.equal(
    await modal.locator(".operator-avatar-special-label").count(),
    0,
  );
  const downloadEvent = page.waitForEvent("download");
  await modal.getByRole("button", { name: "下载 PNG" }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.png$/);
  await page.reload();
  await page.getByText("排班表参考", { exact: true }).first().click();
  assert.equal(
    await page.getByRole("checkbox", { name: "显示剩余心情" }).isChecked(),
    false,
  );
  assert.equal(
    await page.getByRole("checkbox", { name: "映射特殊干员" }).isChecked(),
    true,
  );
  console.log("Export preview, PNG download and persisted settings passed");
} finally {
  await browser.close();
  await server.close();
}
