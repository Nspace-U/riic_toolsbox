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
  async function renderSimulatorPage() {
    const app = createSSRApp(SimulatorPage);
    app.use(Antd);
    return renderToString(app);
  }

  const defaultHtml = await renderSimulatorPage();
  assert.doesNotMatch(defaultHtml, /simulator-facility-queue-description/);
  assert.doesNotMatch(defaultHtml, /有描述/);
  assert.doesNotMatch(defaultHtml, /simulator-queue-description-height/);
  assert.match(defaultHtml, /class="simulator-layout-summary"/);
  assert.match(defaultHtml, /class="simulator-power-summary"/);
  console.log("simulator layout regression: passed");
} finally {
  await vite.close();
}
