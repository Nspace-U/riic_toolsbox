import assert from "node:assert/strict";
import { createServer } from "vite";

const storedValues = [];
globalThis.window = {
  localStorage: {
    getItem(key) {
      if (key === "riic-tools:schedule-documents:v1") {
        return JSON.stringify(storedValues);
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
  const scheduleModule = await vite.ssrLoadModule("/src/utils/schedule.ts");
  const scheduleDocumentsModule = await vite.ssrLoadModule(
    "/src/composables/useScheduleDocuments.ts",
  );
  const fullDocument = {
    layout: [
      { type: "control", level: 5 },
      { type: "trading", level: 3 },
      { type: "trading", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "manufacture", level: 3 },
      { type: "power", level: 3 },
      { type: "power", level: 3 },
      { type: "meeting", level: 3 },
      { type: "processing", level: 3 },
      { type: "hire", level: 3 },
      { type: "training", level: 3 },
    ],
    plans: [{ rooms: {} }, { rooms: {} }, { rooms: {} }],
  };

  assert.deepEqual(scheduleModule.automaticScheduleTags(fullDocument), [
    "242",
    "右满",
    "3队列",
  ]);
  assert.deepEqual(
    scheduleModule.automaticScheduleTags({
      ...fullDocument,
      layout: fullDocument.layout.filter((entry) => entry.type !== "training"),
    }),
    ["242", "右不满", "3队列"],
  );
  assert.deepEqual(
    scheduleModule.scheduleTags(fullDocument, ["自定义", "右满"], ["右满"]),
    [
      { label: "242", automatic: true },
      { label: "3队列", automatic: true },
      { label: "自定义", automatic: false },
    ],
  );
  assert.deepEqual(scheduleModule.scheduleTags(fullDocument, [], ["242"]), [
    { label: "右满", automatic: true },
    { label: "3队列", automatic: true },
  ]);

  const scheduleDocuments = scheduleDocumentsModule.useScheduleDocuments();
  const first = scheduleDocuments.createDocument({
    ...scheduleModule.createEmptySchedule(),
    title: "第一份",
  });
  const second = scheduleDocuments.createDocument({
    ...scheduleModule.createEmptySchedule(),
    title: "第二份",
  });
  const third = scheduleDocuments.createDocument({
    ...scheduleModule.createEmptySchedule(),
    title: "第三份",
  });
  scheduleDocuments.reorderDocuments(first.id, third.id, "after");
  assert.deepEqual(
    scheduleDocuments.documents.value.map(({ document }) => document.title),
    ["第二份", "第三份", "第一份"],
  );
  scheduleDocuments.reorderDocuments(first.id, second.id, "before");
  assert.deepEqual(
    scheduleDocuments.documents.value.map(({ document }) => document.title),
    ["第一份", "第二份", "第三份"],
  );
  console.log("schedule list regression: passed");
} finally {
  await vite.close();
}
