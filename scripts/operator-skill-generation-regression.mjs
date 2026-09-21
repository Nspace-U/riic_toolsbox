import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const skillRoot = path.join(projectRoot, "public", "assets", "operator-skills");
const characterTable = JSON.parse(
  await readFile(
    path.join(
      projectRoot,
      "public",
      "assets",
      "gamedata",
      "latest",
      "excel",
      "character_table.json",
    ),
    "utf8",
  ),
);

const expectedOperatorIds = Object.entries(characterTable)
  .filter(([id, character]) => id.startsWith("char_") && character?.name)
  .map(([id]) => id)
  .sort();
const actualOperatorIds = (await readdir(skillRoot))
  .filter((fileName) => fileName.endsWith(".json"))
  .map((fileName) => fileName.slice(0, -5))
  .sort();
assert.deepEqual(actualOperatorIds, expectedOperatorIds);

const cases = [
  ["char_010_chen", "德才兼备", "cc.g.lgd"],
  ["char_197_poca", "学生会会长", "cc.g.ussg"],
  ["char_1011_lava2", "异格者", "cc.g.sp"],
  ["char_1021_kroos2", "异格者", "cc.g.sp"],
  ["char_1024_hbisc2", "异格者", "cc.g.sp"],
  ["char_456_ash", "彩虹小队", "cc.g.R6"],
  ["char_457_blitz", "彩虹小队", "cc.g.R6"],
  ["char_458_rfrost", "彩虹小队", "cc.g.R6"],
  ["char_459_tachak", "彩虹小队", "cc.g.R6"],
  ["char_206_gnosis", "幕后指挥", "cc.g.karlan"],
];

for (const [id, skillName, group] of cases) {
  const file = JSON.parse(
    await readFile(path.join(skillRoot, `${id}.json`), "utf8"),
  );
  assert.equal(file.schemaVersion, 1, `${id} schema version`);
  assert.equal(typeof file.rarity, "number", `${id} rarity`);
  assert.ok(Array.isArray(file.termKeys), `${id} term keys`);
  assert.ok(file.termKeys.includes(group), `${id} term key`);
  const stage = file.chains
    .find((chain) => chain.room === "control")
    ?.stages.find((candidate) => candidate.name === skillName);
  const effects = stage?.effects ?? [];
  assert.equal(effects.length, 1, `${id} ${skillName} effect count`);
  assert.deepEqual(effects[0], {
    target: "control",
    stat: "moodRecover",
    scope: "room",
    per: {
      per: 1,
      value: 0.05,
      source: "opGroupInFacility",
      group,
      facility: "same",
    },
  });
}

console.log("operator skill generation regression: passed");
