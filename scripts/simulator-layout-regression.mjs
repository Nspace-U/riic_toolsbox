import assert from "node:assert/strict";
import { createServer } from "vite";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import Antd from "ant-design-vue";

const document = {
  title: "描述布局回归",
  layout: [
    { type: "control", level: 5 },
    { type: "trading", level: 3 },
  ],
  plans: [
    {
      name: "队列1",
      duration: 720,
      rooms: {
        control: [{}],
        trading: [{ operators: ["阿米娅"], description: "有描述" }],
      },
    },
    {
      name: "队列2",
      duration: 720,
      rooms: {
        control: [{}],
        trading: [{ operators: ["令"] }],
      },
    },
  ],
};
const stored = [
  {
    id: "description-layout-default",
    document,
    inferredLayout: true,
    sourceFileName: "description-layout.txt",
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
  },
  {
    id: "description-layout-on",
    document: {
      ...document,
      title: "描述布局回归（开启）",
    },
    inferredLayout: true,
    sourceFileName: "description-layout.txt",
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
  },
  {
    id: "description-layout-off",
    document: {
      ...document,
      title: "描述布局回归（关闭）",
    },
    inferredLayout: true,
    sourceFileName: "description-layout.txt",
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
  },
];

globalThis.window = {
  localStorage: {
    getItem(key) {
      if (key === "riic-tools:schedule-documents:v1") {
        return JSON.stringify(stored);
      }
      if (key === "riic-tools:schedule-active-document:v1") {
        return "description-layout-default";
      }
      if (key === "riic-tools:simulator-edit-settings:v1") {
        return JSON.stringify({
          "description-layout-on": { showFacilityDescriptions: true },
          "description-layout-off": { layout: false },
        });
      }
      return null;
    },
    setItem() {},
  },
};

const vite = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});

try {
  const { default: SimulatorPage } = await vite.ssrLoadModule(
    "/src/pages/SimulatorPage.vue",
  );
  const { useScheduleDocuments } = await vite.ssrLoadModule(
    "/src/composables/useScheduleDocuments.ts",
  );
  async function renderSimulatorPage() {
    const app = createSSRApp(SimulatorPage);
    app.use(Antd);
    return renderToString(app);
  }

  const defaultHtml = await renderSimulatorPage();
  const defaultDescriptions = [
    ...defaultHtml.matchAll(
      /<div class="simulator-facility-queue-description">([\s\S]*?)<\/div>/g,
    ),
  ].map((match) => match[1]?.trim() ?? "");

  assert.equal(defaultDescriptions.length, 0);
  assert.match(defaultHtml, /simulator-queue-description-height[^>]*0px/);
  assert.match(defaultHtml, /class="simulator-layout-summary"/);
  assert.match(defaultHtml, /class="simulator-power-summary"/);

  useScheduleDocuments().setActiveDocument("description-layout-on");
  const enabledHtml = await renderSimulatorPage();
  const enabledDescriptions = [
    ...enabledHtml.matchAll(
      /<div class="simulator-facility-queue-description">([\s\S]*?)<\/div>/g,
    ),
  ].map((match) => match[1]?.trim() ?? "");

  assert.equal(enabledDescriptions.length, 4);
  assert.equal(
    enabledDescriptions.filter((value) => value === "有描述").length,
    1,
  );
  assert.equal(enabledDescriptions.filter((value) => value === "").length, 3);
  assert.match(enabledHtml, /simulator-queue-description-height[^>]*21px/);

  useScheduleDocuments().setActiveDocument("description-layout-off");
  const disabledHtml = await renderSimulatorPage();
  assert.doesNotMatch(disabledHtml, /class="simulator-layout-panel"/);
  assert.doesNotMatch(disabledHtml, /class="simulator-layout-summary"/);
  assert.doesNotMatch(disabledHtml, /class="simulator-power-summary"/);
  console.log("simulator layout regression: passed");
} finally {
  await vite.close();
}
