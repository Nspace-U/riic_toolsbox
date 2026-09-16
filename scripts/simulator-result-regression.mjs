import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [template, stylesheet] = await Promise.all([
  readFile("src/pages/SimulatorPage.vue", "utf8"),
  readFile("src/assets/main.css", "utf8"),
]);

const calculationIndex = template.indexOf(
  '<div class="simulator-calculation-steps">',
);
const queueIndex = template.indexOf('key="daily-output-breakdown"');
const basePointIndex = template.indexOf('key="base-points"');
const basePointEndIndex = template.indexOf(
  '<template v-if="calculationStepDisplayMode',
  basePointIndex,
);
const calculationEndIndex = template.indexOf(
  "</div>\n          </template>\n        </a-card>",
  calculationIndex,
);

assert.ok(calculationIndex >= 0);
assert.ok(queueIndex > calculationIndex);
assert.ok(basePointIndex > queueIndex);
assert.ok(basePointEndIndex > basePointIndex);
assert.ok(calculationEndIndex > basePointIndex);

const calculationBlock = template.slice(calculationIndex, calculationEndIndex);
const queueBlock = template.slice(queueIndex, basePointIndex);
const basePointBlock = template.slice(basePointIndex, basePointEndIndex);

assert.match(calculationBlock, /<a-collapse ghost>/);
assert.match(queueBlock, /v-for="queue in dailyOutputQueueDetails"/);
assert.match(queueBlock, /class="simulator-calculation-step-columns"/);
assert.match(queueBlock, /class="simulator-calculation-step-column"/);
assert.match(queueBlock, /<span>队列计算明细<\/span>/);
assert.doesNotMatch(
  queueBlock,
  /<span class="simulator-step-subheading">队列计算明细<\/span>/,
);
assert.doesNotMatch(queueBlock, /<a-alert[\s\S]*?queue\.sanity\.complete/);
assert.match(basePointBlock, /v-for="entry in basePointQueueDetails"/);
assert.match(basePointBlock, /v-for="point in entry\.points"/);
assert.match(basePointBlock, /class="simulator-base-point-value"/);
assert.match(basePointBlock, /<span>基地点数<\/span>/);
assert.doesNotMatch(
  basePointBlock,
  /<span class="simulator-step-subheading">基地点数<\/span>/,
);
assert.doesNotMatch(basePointBlock, /<a-collapse-panel[\s\S]*?v-for=/);
assert.doesNotMatch(basePointBlock, /simulator-base-point-source-title/);
assert.doesNotMatch(template, /class="simulator-daily-output-breakdown"/);
assert.doesNotMatch(template, /class="simulator-base-point-results"/);
assert.match(template, /function dailyOutputSourceFacility\(product: string\)/);
assert.match(template, /if \(product === "信用"\) \{\s+return "meeting";/);
assert.match(template, /function dailyOutputCardStyle\(/);
assert.equal(
  (template.match(/:style="dailyOutputCardStyle\(card\)"/g) ?? []).length,
  2,
);
assert.match(template, /simulator-daily-output-item--source/);
assert.match(template, /dailySanityResult\.missing\.join/);
assert.doesNotMatch(template, /ROOM_LABELS\[facility\.type\]\}（合并）/);
assert.doesNotMatch(stylesheet, /simulator-step-formula/);
assert.match(stylesheet, /\.simulator-step-detail-grid strong small/);
assert.match(
  stylesheet,
  /\.simulator-skill-detail-calculation-label\s*\{[\s\S]*?color: #72807f;/,
);
assert.match(
  stylesheet,
  /\.simulator-daily-output-item--source\s*\{[\s\S]*?color-mix\(/,
);

console.log("simulator result regression: passed");
