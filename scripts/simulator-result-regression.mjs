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
const calculationStepContent = await readFile(
  "src/components/SimulatorCalculationStepContent.vue",
  "utf8",
);

assert.match(
  calculationBlock,
  /<a-collapse\s+v-model:active-key="calculationStepActiveKeys"\s+ghost>/,
);
const maaDroneIndex = calculationBlock.indexOf('key="maa-drone-acceleration"');
assert.ok(maaDroneIndex > 0 && maaDroneIndex < queueIndex - calculationIndex);
const maaDroneBlock = calculationBlock.slice(
  0,
  calculationBlock.indexOf('key="daily-output-breakdown"'),
);
assert.match(maaDroneBlock, /v-for="queue in maaDroneQueueDetails"/);
assert.match(maaDroneBlock, /当前队列未设置无人机加速/);
assert.match(maaDroneBlock, /<span>基础速率<\/span>/);
assert.match(maaDroneBlock, /detail\.baseAmountPerHour/);
assert.match(queueBlock, /v-for="queue in dailyOutputQueueDetails"/);
assert.match(queueBlock, /class="simulator-calculation-step-columns"/);
assert.match(queueBlock, /class="simulator-calculation-step-column"/);
assert.match(queueBlock, /<span>队列计算明细<\/span>/);
assert.match(queueBlock, /队列时长总产出/);
assert.match(queueBlock, /v-for="material in facility\.materials"/);
assert.match(queueBlock, /v-for="material in product\.materials"/);
assert.match(queueBlock, /基础材料消耗速率/);
assert.doesNotMatch(queueBlock, /<span>基础效率<\/span>/);
assert.doesNotMatch(queueBlock, /· 基础效率<\/span>/);
assert.match(queueBlock, /队列折算<\/span>/);
assert.doesNotMatch(queueBlock, /队列折算每日/);
assert.match(queueBlock, /队列时长总消耗/);
assert.match(queueBlock, /sanityIconUrl\(\)/);
assert.match(queueBlock, /理智\/日/);
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
assert.doesNotMatch(template, /combinationEfficiency/);
assert.doesNotMatch(
  template,
  /card\.droneExtraAmount|card\.droneBeforeAmount|card\.droneExtraMaterials/,
);
assert.doesNotMatch(template, /<span>编辑产物<\/span>/);
assert.doesNotMatch(template, /所有队列无人机加速/);
assert.match(template, /function maaDroneOrderForFacility\(/);
assert.match(
  template,
  /class="[^"]*simulator-efficiency-summary-drone-icon[^"]*"/,
);
assert.match(template, /LABOR_ICON_URL/);
assert.match(stylesheet, /\.simulator-efficiency-summary-drone-icon/);
assert.match(stylesheet, /\.simulator-efficiency-summary-drone-icon--pre/);
assert.match(stylesheet, /\.simulator-efficiency-summary-drone-icon--post/);
assert.match(template, /scope: "operator"/);
assert.match(template, /menu\.scope !== "operator"/);
assert.match(calculationStepContent, /<span>干员心情效率<\/span>/);
assert.doesNotMatch(calculationStepContent, /<span>计算公式<\/span>/);
const inheritedIndex = calculationStepContent.indexOf(">继承说明<");
const summaryIndex = calculationStepContent.indexOf(">效率汇总<");
assert.ok(inheritedIndex >= 0 && inheritedIndex < summaryIndex);
assert.doesNotMatch(calculationStepContent, /干员组合贡献/);
assert.match(template, /function dailyOutputSourceFacility\(product: string\)/);
assert.match(template, /if \(product === "信用"\) \{\s+return "meeting";/);
assert.match(template, /function dailyOutputCardAccent\(/);
assert.match(template, /const productColor = productAccent\(card\.product\);/);
assert.match(template, /function dailyOutputCardHasAccent\(/);
assert.match(template, /function dailyOutputCardStyle\(/);
assert.equal(
  (template.match(/:style="dailyOutputCardStyle\(card\)"/g) ?? []).length,
  2,
);
assert.match(template, /simulator-daily-output-item--accent/);
assert.match(template, /dailySanityResult\.missing\.join/);
assert.doesNotMatch(template, /ROOM_LABELS\[facility\.type\]\}（合并）/);
const facilityResultLabelStart = template.indexOf(
  "function facilityResultLabel(result: FacilityEfficiencyResult): string {",
);
const facilityResultLabelEnd = template.indexOf(
  "\nfunction basePointLabel(",
  facilityResultLabelStart,
);
const facilityResultLabelBlock = template.slice(
  facilityResultLabelStart,
  facilityResultLabelEnd,
);
assert.match(
  facilityResultLabelBlock,
  /formatFacilityResultLabel\(result, currentDocument\.value\?\.layout \?\? \[\]\)/,
);
assert.doesNotMatch(stylesheet, /simulator-step-formula/);
assert.match(stylesheet, /\.simulator-step-detail-grid strong small/);
assert.match(
  stylesheet,
  /\.simulator-skill-detail-calculation-label\s*\{[\s\S]*?color: #72807f;/,
);
assert.match(
  stylesheet,
  /\.simulator-daily-output-item--accent\s*\{[\s\S]*?color-mix\(/,
);

console.log("simulator result regression: passed");
