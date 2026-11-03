import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const server = await createServer({
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
let browser;

try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1367, height: 900 },
  });
  await page.goto(`http://127.0.0.1:${address.port}/simulator`);
  await page.evaluate(async () => {
    const { createEmptySchedule } = await import("/src/utils/schedule.ts");
    const base = createEmptySchedule();
    const make = (id, title, tags, extra = []) => ({
      id,
      document: { ...base, title, layout: [...base.layout, ...extra] },
      tags,
      inferredLayout: false,
      sourceFileName: "",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    localStorage.setItem(
      "riic-tools:schedule-documents:v1",
      JSON.stringify([
        make("a", "第一份", [
          "100",
          "自用",
          "非常非常非常长的用户自定义标签用于测试宽度",
        ]),
        make("b", "第二份", ["备用"], [{ type: "trading", level: 1 }]),
      ]),
    );
    localStorage.setItem("riic-tools:schedule-active-document:v1", "a");
  });
  await page.reload();
  await page.locator(".simulator-tag-filters").waitFor();
  const dimensions = await page.evaluate(() => {
    const sidebar = document.querySelector(".simulator-document-sidebar");
    const editor = document.querySelector(".simulator-editor");
    const filters = document.querySelector(".simulator-tag-filters");
    const width = sidebar.getBoundingClientRect().width;
    const gap =
      editor.getBoundingClientRect().left -
      sidebar.getBoundingClientRect().right;
    filters.style.display = "none";
    const baseline = sidebar.getBoundingClientRect().width;
    filters.style.display = "";
    return { width, baseline, gap };
  });
  assert.ok(Math.abs(dimensions.width - dimensions.baseline) < 1);
  assert.ok(Math.abs(dimensions.gap - 12) < 1);

  assert.deepEqual(
    await page.locator(".simulator-tag-filter-group").allTextContents(),
    [
      "000100",
      "右不满",
      "1队列",
      "自用非常非常非常长的用户自定义标签用于测试宽度备用",
    ],
  );
  const automatic = page.getByRole("checkbox", { name: "100", exact: true });
  const custom = page.getByRole("checkbox", { name: "自用", exact: true });
  assert.equal(await automatic.count(), 1);
  assert.match(await automatic.getAttribute("class"), /ant-tag-blue/);
  assert.doesNotMatch(await custom.getAttribute("class"), /ant-tag-blue/);
  await automatic.click();
  assert.equal(await automatic.getAttribute("aria-checked"), "true");
  assert.deepEqual(
    await page.locator(".simulator-document-item-title").allTextContents(),
    ["第一份", "第二份"],
  );
  await custom.focus();
  await custom.press("Space");
  assert.deepEqual(
    await page.locator(".simulator-document-item-title").allTextContents(),
    ["第一份"],
  );
  await page.getByPlaceholder("搜索排班表名称或标签").fill("第二份");
  await page.getByRole("button", { name: "清空筛选" }).click();
  assert.equal(await page.locator(".simulator-document-item-title").count(), 2);

  await page.evaluate(() => {
    const key = "riic-tools:schedule-documents:v1";
    const docs = JSON.parse(localStorage.getItem(key));
    docs[0].tags.push(
      ...Array.from({ length: 100 }, (_, index) => `额外标签${index}`),
    );
    localStorage.setItem(key, JSON.stringify(docs));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator(".simulator-tag-filters .ant-tag").last().waitFor();
  await page.waitForTimeout(100);
  const mobile = await page.evaluate(() => {
    const sidebar = document.querySelector(".simulator-document-sidebar");
    const filters = document.querySelector(".simulator-tag-filters");
    const list = document.querySelector(".simulator-document-list");
    const tags = [...filters.querySelectorAll(".ant-tag")];
    const last = tags.at(-1).getBoundingClientRect();
    const bounds = filters.getBoundingClientRect();
    return {
      width: sidebar.getBoundingClientRect().width,
      parentWidth: sidebar.parentElement.getBoundingClientRect().width,
      position: getComputedStyle(sidebar).position,
      listHeight: list.getBoundingClientRect().height,
      count: tags.length,
      contained: last.bottom <= bounds.bottom && last.right <= bounds.right + 1,
    };
  });
  assert.ok(Math.abs(mobile.width - mobile.parentWidth) < 1);
  assert.equal(mobile.count, 107);
  assert.equal(mobile.position, "static");
  assert.ok(mobile.listHeight >= 120 && mobile.contained);
  console.log("simulator tag regression: passed");
} finally {
  await browser?.close();
  await server.close();
}
