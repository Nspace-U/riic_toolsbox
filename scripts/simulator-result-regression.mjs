import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const template = await readFile("src/pages/SimulatorPage.vue", "utf8");
const droneIndex = template.indexOf('class="simulator-drone-acceleration"');
const queueIndex = template.indexOf('class="simulator-daily-output-breakdown"');
const basePointIndex = template.indexOf('class="simulator-base-point-results"');

assert.ok(droneIndex >= 0);
assert.ok(queueIndex >= 0);
assert.ok(basePointIndex > queueIndex);
assert.ok(droneIndex < queueIndex);

const queueBlock = template.slice(queueIndex, basePointIndex);
assert.equal((queueBlock.match(/<a-collapse-panel/g) ?? []).length, 1);
assert.match(queueBlock, /key="daily-output-breakdown"/);
assert.match(queueBlock, /class="simulator-step-content"/);
assert.match(queueBlock, /v-for="queue in dailyOutputQueueDetails"/);
assert.doesNotMatch(queueBlock, /<a-collapse-panel\s+v-for=/);
assert.doesNotMatch(queueBlock, /(?:activeKey|defaultActiveKey)/);

console.log("simulator result regression: passed");
