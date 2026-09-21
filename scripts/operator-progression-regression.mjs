import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageModule = await import(
  pathToFileURL(
    path.join(projectRoot, "packages", "riic-efficiency", "dist", "index.js"),
  ).href
);

{
  const { resolveOperatorProgression } = packageModule;
  const skillFile = {
    id: "test_operator",
    name: "测试干员",
    chains: [
      {
        slot: 0,
        room: "trading",
        stages: [
          { unlock: { type: "elite", value: 2 }, name: "精英2", effects: [] },
          { unlock: { type: "level", value: 30 }, name: "30级", effects: [] },
        ],
      },
    ],
  };

  function profile(elite, level) {
    const entry = {
      id: "test_operator",
      name: "测试干员",
      elite,
      level,
      owned: true,
      rarity: 6,
    };
    return {
      id: "profile",
      name: "测试档案",
      entries: { test_operator: entry },
      importedEntries: { test_operator: { ...entry } },
      createdAt: "",
      updatedAt: "",
    };
  }

  function resolve(options = {}) {
    return resolveOperatorProgression({
      operatorId: "test_operator",
      facility: "trading",
      operatorSkillFile: skillFile,
      maxEliteLevel: 2,
      treatSkillsAsUnlocked: true,
      ...options,
    });
  }

  assert.equal(
    resolve({
      profile: profile(2, 1),
      manualElite: 1,
      manualLevel: 90,
    }).upgraded,
    false,
  );
  assert.equal(
    resolve({
      profile: profile(2, 1),
      manualLevel: 90,
    }).upgraded,
    true,
  );
  assert.equal(
    resolve({
      profile: profile(1, 90),
      manualElite: 2,
      manualLevel: 1,
    }).upgraded,
    true,
  );
  assert.equal(
    resolve({
      profile: profile(1, 30),
      manualElite: 1,
      manualLevel: 30,
    }).upgraded,
    false,
  );
  assert.equal(
    resolve({
      profile: profile(1, 30),
      manualElite: 1,
      manualLevel: 31,
    }).upgraded,
    true,
  );
  assert.equal(resolve({ profile: profile(1, 80) }).upgraded, true);
  assert.equal(resolve({ manualElite: 1, manualLevel: 1 }).upgraded, true);
  console.log("operator progression regression: passed");
}
