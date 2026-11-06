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
          ? { ...base, title: id, description: "排班说明".repeat(18) }
          : {
              ...base,
              title: id,
              description: "超长描述".repeat(45),
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
  assert.equal(
    await page.getByRole("checkbox", { name: "显示资源详情" }).isChecked(),
    false,
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
  const referenceCards = page.locator(".schedule-reference-card");
  assert.equal(
    await referenceCards.locator(".simulator-daily-output-card-copy").count(),
    0,
  );
  assert.equal(
    await referenceCards.locator(".simulator-daily-output-total").count(),
    0,
  );
  const longDescriptionFits = await referenceCards.nth(1).evaluate((card) => {
    const frame = card
      .querySelector(".simulator-image-export-root")
      .getBoundingClientRect();
    const description = card.querySelector(
      ".simulator-image-export-description",
    );
    const rect = description.getBoundingClientRect();
    return (
      getComputedStyle(description).whiteSpace === "pre" &&
      rect.right <= frame.right + 1
    );
  });
  assert.equal(longDescriptionFits, true);
  await page.getByRole("checkbox", { name: "显示资源详情" }).check();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        ".schedule-reference-card .simulator-daily-output-total",
      ).length === 2,
  );
  assert.ok(
    (await referenceCards
      .locator(".simulator-daily-output-card-copy")
      .count()) >= 2,
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
      ".simulator-editor .simulator-daily-output-grid .simulator-daily-output-item:not(.simulator-daily-output-total)",
    )
    .first()
    .waitFor();
  await page.evaluate(() => {
    const grid = document.querySelector(
      ".simulator-editor .simulator-daily-output-grid",
    );
    const original = grid.querySelector(
      ".simulator-daily-output-item:not(.simulator-daily-output-total)",
    );
    for (let index = 0; index < 6; index += 1) {
      const card = original.cloneNode(true);
      card.dataset.testIndex = String(index);
      card.style.width = `${110 + index * 25}px`;
      grid.append(card);
    }
  });
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
  assert.equal(
    await modal.getByRole("checkbox", { name: "显示资源详情" }).isChecked(),
    true,
  );
  await modal.getByRole("checkbox", { name: "显示资源详情" }).uncheck();
  await modal
    .locator(".simulator-daily-output-total")
    .waitFor({ state: "hidden" });
  await modal.locator(".simulator-image-export-resource-row").first().waitFor();
  const geometry = await modal.evaluate((dialog) => {
    const root = dialog.querySelector(".simulator-image-export-root");
    const description = root.querySelector(
      ".simulator-image-export-description",
    );
    const grid = root.querySelector(".simulator-daily-output-grid");
    const rows = Array.from(grid.children);
    const frame = root.getBoundingClientRect();
    const cards = Array.from(
      grid.querySelectorAll(".simulator-daily-output-item"),
    );
    const cardRects = cards.map((card) => card.getBoundingClientRect());
    const rowRects = rows.map((row) =>
      Array.from(row.children).map((card) => card.getBoundingClientRect()),
    );
    const cardGap = rowRects[0][1].left - rowRects[0][0].right;
    function width(rects) {
      return (
        rects.reduce((total, rect) => total + rect.width, 0) +
        Math.max(0, rects.length - 1) * cardGap
      );
    }
    const actualDifference = Math.abs(width(rowRects[0]) - width(rowRects[1]));
    const minimumDifference = Math.min(
      ...cardRects
        .slice(1)
        .map((_, index) =>
          Math.abs(
            width(cardRects.slice(0, index + 1)) -
              width(cardRects.slice(index + 1)),
          ),
        ),
    );
    return {
      descriptionSize: getComputedStyle(description).fontSize,
      descriptionWhiteSpace: getComputedStyle(description).whiteSpace,
      numberSize: getComputedStyle(
        cards[0].querySelector(".simulator-daily-output-main-value"),
      ).fontSize,
      rows: rows.length,
      indexes: cards
        .filter((card) => card.dataset.testIndex !== undefined)
        .map((card) => card.dataset.testIndex),
      inside: cards.every(
        (card) => card.getBoundingClientRect().right <= frame.right + 1,
      ),
      balanced: Math.abs(actualDifference - minimumDifference) < 1,
      separateRows: rowRects[1][0].top >= rowRects[0][0].bottom - 1,
      copiedDetails: root.querySelectorAll(
        ".simulator-daily-output-card-copy, .simulator-daily-output-total",
      ).length,
      debug: {
        root: frame.toJSON(),
        heading: root
          .querySelector(".simulator-image-export-heading")
          .getBoundingClientRect()
          .toJSON(),
        grid: grid.getBoundingClientRect().toJSON(),
        gridTransform: grid.style.transform,
        cards: cards.map((card) => card.getBoundingClientRect().toJSON()),
      },
    };
  });
  assert.equal(geometry.descriptionSize, "18px");
  assert.equal(geometry.numberSize, "18px");
  assert.equal(geometry.descriptionWhiteSpace, "pre");
  assert.equal(geometry.rows, 2);
  assert.deepEqual(geometry.indexes, ["0", "1", "2", "3", "4", "5"]);
  assert.equal(geometry.inside, true, JSON.stringify(geometry.debug));
  assert.equal(geometry.balanced, true);
  assert.equal(geometry.separateRows, true);
  assert.equal(geometry.copiedDetails, 0);
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
  assert.equal(
    await page.getByRole("checkbox", { name: "显示资源详情" }).isChecked(),
    false,
  );
  const layoutPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await layoutPage.addInitScript(() => {
    const control = { type: "control", level: 5 };
    const trading = Array.from({ length: 3 }, () => ({
      type: "trading",
      level: 3,
    }));
    const manufacture = Array.from({ length: 5 }, () => ({
      type: "manufacture",
      level: 3,
    }));
    const power = Array.from({ length: 3 }, () => ({
      type: "power",
      level: 3,
    }));
    const assignments = (count, slots) =>
      Array.from({ length: count }, () => ({
        operators: Array(slots).fill("阿米娅"),
      }));
    const document = {
      title: "间距测试",
      layout: [control, ...trading, ...manufacture, ...power],
      plans: [
        {
          name: "队列1",
          duration: 720,
          rooms: {
            control: assignments(1, 5),
            trading: assignments(3, 3),
            manufacture: assignments(5, 3),
            power: assignments(3, 1),
          },
        },
      ],
    };
    localStorage.setItem(
      "riic-tools:schedule-documents:v1",
      JSON.stringify([
        {
          id: "spacing",
          document,
          inferredLayout: false,
          sourceFileName: "",
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        },
      ]),
    );
    localStorage.setItem("riic-tools:schedule-active-document:v1", "spacing");
    localStorage.setItem(
      "riic-tools:schedule-image-settings:v1",
      JSON.stringify({
        mapSpecialOperators: false,
      }),
    );
  });
  await layoutPage.goto(`http://127.0.0.1:${address.port}/simulator`);
  await layoutPage
    .locator(".simulator-editor .operator-avatar-display")
    .first()
    .waitFor();
  await layoutPage.getByText("排班表参考", { exact: true }).first().click();
  try {
    await layoutPage.waitForFunction(
      () =>
        document.querySelectorAll(
          ".schedule-reference-card .simulator-export-facility-row",
        ).length === 2,
      undefined,
      { timeout: 10000 },
    );
  } catch (error) {
    console.error(await layoutPage.locator("body").innerText());
    throw error;
  }
  const spacing = await layoutPage
    .locator(".schedule-reference-card")
    .evaluate((card) => {
      const rows = Array.from(
        card.querySelectorAll(".simulator-export-facility-row"),
      );
      const first = rows[0].querySelectorAll(".simulator-facility-card");
      const second = rows[1].querySelector(".simulator-facility-card");
      const a = first[0].getBoundingClientRect();
      const b = first[1].getBoundingClientRect();
      const c = second.getBoundingClientRect();
      const entries = rows[0].querySelector(".simulator-queue-entries");
      const style = getComputedStyle(entries);
      const grid = card.querySelector(".simulator-export-facility-grid");
      return {
        horizontal: b.left - a.right,
        vertical: c.top - a.bottom,
        paddingStart: style.paddingInlineStart,
        paddingEnd: style.paddingInlineEnd,
        expected: (10 * grid.getBoundingClientRect().width) / grid.offsetWidth,
      };
    });
  assert.equal(spacing.paddingStart, "4px");
  assert.equal(spacing.paddingEnd, "4px");
  assert.ok(spacing.horizontal > 0);
  assert.ok(
    Math.abs(spacing.horizontal - spacing.expected) < 1,
    JSON.stringify(spacing),
  );
  assert.ok(
    Math.abs(spacing.horizontal - spacing.vertical) < 1,
    JSON.stringify(spacing),
  );
  await layoutPage.close();
  console.log("Export preview, PNG download and persisted settings passed");
} finally {
  await browser.close();
  await server.close();
}
