import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSourceText(filePath) {
  const text = await readFile(filePath, "utf8");
  return text.replace(/\r\n/g, "\n");
}

const [template, stylesheet] = await Promise.all([
  readSourceText("src/pages/SimulatorPage.vue"),
  readSourceText("src/assets/main.css"),
]);

const resultDisplayIndex = template.indexOf(
  '<template v-else-if="efficiencyResult',
);
const calculationIndex = template.indexOf(
  '<div class="simulator-calculation-steps">',
);
const queueIndex = template.indexOf('key="daily-output-breakdown"');
const basePointIndex = template.indexOf('key="base-points"');
const facilityModeIndex = template.indexOf(
  "v-if=\"calculationStepDisplayMode === 'facility'\"",
  basePointIndex,
);
const calculationEndIndex = template.indexOf(
  "</div>\n          </template>\n        </a-card>",
  calculationIndex,
);

assert.ok(resultDisplayIndex >= 0);
assert.ok(calculationIndex > resultDisplayIndex);
assert.ok(queueIndex > calculationIndex);
assert.ok(basePointIndex > queueIndex);
assert.ok(facilityModeIndex > basePointIndex);
assert.ok(calculationEndIndex > facilityModeIndex);

const calculationBlock = template.slice(calculationIndex, calculationEndIndex);
const queueBlock = template.slice(queueIndex, basePointIndex);
const basePointBlock = template.slice(basePointIndex, facilityModeIndex);
const resultBlock = template.slice(resultDisplayIndex, calculationEndIndex);

assert.match(template, /const resultDisplay = computed<ResultDisplay/);
assert.match(template, /return buildResultDisplay\(result, \{/);
assert.match(template, /sourceFacilityForProduct: dailyOutputSourceFacility/);
assert.match(
  template,
  /function dailyOutputSourceFacility\(product: string\): RoomKey \| undefined \{/,
);
assert.match(template, /if \(product === "信用"\) \{\s+return "meeting";/);

assert.match(template, /import SimulatorDisplayCard from/);
assert.match(template, /import SimulatorDisplayTile from/);
assert.match(template, /import SimulatorDisplayValue from/);
assert.doesNotMatch(template, /SimulatorCalculationStepContent/);

assert.match(
  calculationBlock,
  /<a-collapse\s+v-model:active-key="calculationStepActiveKeys"\s+ghost>/,
);
assert.match(calculationBlock, /key="maa-drone-acceleration"/);
assert.match(
  calculationBlock,
  /v-for="card in resultDisplay\.calculationSteps\.maaDrone\s*\.cards"/,
);
assert.match(
  calculationBlock,
  /<SimulatorDisplayCard\s+:card="card"\s+:icon-url="dailyOutputIconUrl"\s*\/>/,
);

assert.match(queueBlock, /key="daily-output-breakdown"/);
assert.match(queueBlock, /class="simulator-calculation-step-columns"/);
assert.match(queueBlock, /class="simulator-calculation-step-column"/);
assert.match(
  queueBlock,
  /v-for="card in resultDisplay\.calculationSteps\.dailyOutput\s*\.cards"/,
);
assert.doesNotMatch(queueBlock, /facility\.materials/);
assert.doesNotMatch(queueBlock, /product\.materials/);
assert.doesNotMatch(queueBlock, /sanityIconUrl\(\)/);

assert.match(
  basePointBlock,
  /v-for="column in resultDisplay\.calculationSteps\.basePoints\s*\.columns"/,
);
assert.match(basePointBlock, /v-for="point in column\.points"/);
assert.match(basePointBlock, /class="simulator-base-point-value"/);
assert.match(basePointBlock, /class="simulator-base-point-sources"/);
assert.match(basePointBlock, /v-for="source in point\.sources"/);
assert.doesNotMatch(basePointBlock, /basePointSourceText\(/);

assert.match(
  calculationBlock,
  /v-for="pane in resultDisplay\.calculationSteps\.facilitySteps\s*\.byFacility"/,
);
assert.match(
  calculationBlock,
  /v-for="card in resultDisplay\.calculationSteps\.facilitySteps\s*\.byQueue"/,
);

assert.doesNotMatch(template, /buildCalculationSteps\(/);
assert.doesNotMatch(template, /buildCalculationStepGroups\(/);
assert.doesNotMatch(template, /buildDailyOutputQueueDetails\(/);
assert.doesNotMatch(template, /buildMaaDroneQueueDetails\(/);
assert.doesNotMatch(template, /buildBasePointQueueDetails\(/);
assert.doesNotMatch(template, /buildDroneScenarioDisplays\(/);
assert.doesNotMatch(template, /otherDroneCandidates/);
assert.doesNotMatch(template, /dailyOutputCardStyle/);
assert.doesNotMatch(template, /dailyOutputCardAccent/);
assert.doesNotMatch(template, /dailySanityResult/);

const stepContentExists = await readFile(
  "src/components/SimulatorCalculationStepContent.vue",
  "utf8",
).then(
  () => true,
  () => false,
);
assert.equal(stepContentExists, false);

const [displayValue, displaySection, displayCard, displayTile] =
  await Promise.all([
    readSourceText("src/components/SimulatorDisplayValue.vue"),
    readSourceText("src/components/SimulatorDisplaySection.vue"),
    readSourceText("src/components/SimulatorDisplayCard.vue"),
    readSourceText("src/components/SimulatorDisplayTile.vue"),
  ]);

assert.match(displayValue, /SimulatorNumericValue/);
assert.match(displayValue, /v-for="\(part, index\) in props\.value\.parts"/);
assert.match(displayValue, /:mode="part\.format"/);

assert.match(
  displaySection,
  /"queue-sanity":\s*"simulator-daily-output-queue-sanity"/,
);
assert.match(displaySection, /class="simulator-step-detail-grid"/);
assert.match(displaySection, /class="simulator-skill-detail-row"/);
assert.match(displaySection, /class="simulator-mood-detail-row"/);
assert.match(displaySection, /class="simulator-drone-candidate-list"/);
assert.match(
  displaySection,
  /class="simulator-skill-detail-calculation-label"/,
);
assert.match(displaySection, /<SimulatorDisplaySection/);
assert.match(displaySection, /:nested="true"|nested/);

assert.match(displayCard, /class="simulator-step-column-empty"/);
assert.match(displayCard, /class="simulator-step-content"/);
assert.match(displayCard, /class="simulator-step-empty"/);

assert.match(displayTile, /class="simulator-daily-output-item"/);
assert.match(displayTile, /'simulator-daily-output-item--net'/);
assert.match(displayTile, /'simulator-daily-output-item--accent'/);
assert.match(
  displayTile,
  /"gross-points": "simulator-daily-output-gross-points"/,
);
assert.match(
  displayTile,
  /"net-resource": "simulator-drone-output-net-resource"/,
);
assert.match(
  displayTile,
  /"sanity-missing": "simulator-daily-output-sanity-missing"/,
);
assert.match(displayTile, /--simulator-daily-output-accent/);
assert.match(displayTile, /line\.key === 'sanity'/);

assert.doesNotMatch(template, /class="simulator-daily-output-breakdown"/);
assert.match(resultBlock, /show-icon/);
assert.equal((resultBlock.match(/type="warning"/g) ?? []).length, 1);
assert.equal((resultBlock.match(/type="error"/g) ?? []).length, 1);
assert.equal((resultBlock.match(/:image="undefined"/g) ?? []).length, 2);
assert.equal((resultBlock.match(/<a-collapse-panel/g) ?? []).length, 5);
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
assert.doesNotMatch(template, /ROOM_LABELS\[facility\.type\]\}（合并）/);
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
assert.match(
  stylesheet,
  /\.simulator-daily-output-queue-sanity\s*\{[\s\S]*?gap: 10px;/,
);
assert.match(stylesheet, /\.simulator-sanity-detail-label\s*\{/);

console.log("simulator result regression: passed");
