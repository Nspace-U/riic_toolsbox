import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});

try {
  const ranking = await vite.ssrLoadModule("/src/utils/efficiencyRanking.ts");
  const { getRiicEfficiencyCatalog } = await vite.ssrLoadModule(
    "/src/adapters/riicEfficiencyData.ts",
  );
  const { parseTorappuData } = await vite.ssrLoadModule(
    "/src/utils/parseTorappuData.ts",
  );
  const [characters, building] = await Promise.all(
    ["character_table", "building_data"].map(async (name) =>
      JSON.parse(
        await readFile(
          `public/assets/gamedata/latest/excel/${name}.json`,
          "utf8",
        ),
      ),
    ),
  );
  const operators = parseTorappuData(characters, building, {});
  const catalog = getRiicEfficiencyCatalog();
  const entries = ranking.buildEfficiencyRankingEntries(
    operators,
    catalog,
    false,
  );
  const layout = ranking.createDefaultEfficiencyRankingLayout();
  const failures = [];

  function check(name, run) {
    try {
      run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(error);
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }

  function calculate(entry) {
    return ranking.calculateEfficiencyRankingEntry(catalog, {
      ...entry,
      schedule: ranking.createEfficiencyRankingSchedule(entry, {
        layout,
        workHours: 24,
        clueExchanging: true,
        treatSkillsAsUnlocked: false,
        dormitoryDefaultIncludesMoodRecovery: false,
        catalog,
      }),
    });
  }

  for (const [name, requirement] of [
    ["缪尔赛思", /5.*莱茵生命|莱茵生命.*5/],
    ["埃癸斯", /结城理.*制造站|制造站.*结城理/],
  ]) {
    check(`${name}在条件满足时仍说明支援要求`, () => {
      const entry = entries.find(
        (row) => row.operator.name === name && row.facility === "power",
      );
      assert.ok(entry);
      assert.match(
        ranking.defaultEfficiencyRankingNote(entry, catalog),
        requirement,
      );
      assert.deepEqual(calculate(entry).notes, []);
    });
  }

  check("备注直接读取当前技能条件和人数上限", () => {
    const changed = structuredClone(catalog);
    const aegis = changed.operators["埃癸斯"].skillFile;
    aegis.chains
      .find((chain) => chain.room === "power")
      .stages[0].effects.find((effect) => effect.condition).condition.op =
      "技能指定搭档";
    const muelsyse = changed.operators["缪尔赛思"].skillFile;
    muelsyse.chains
      .find((chain) => chain.room === "power")
      .stages[0].effects.find((effect) => effect.per).per.cap = 3;
    changed.terms["cc.g.rh"].name = "技能指定阵营";
    for (const [name, expected] of [
      ["埃癸斯", /技能指定搭档.*制造站/],
      ["缪尔赛思", /3.*技能指定阵营|技能指定阵营.*3/],
    ]) {
      const entry = entries.find(
        (row) => row.operator.name === name && row.facility === "power",
      );
      assert.match(
        ranking.defaultEfficiencyRankingNote(entry, changed),
        expected,
      );
    }
  });

  check("线索倾向联动同样自动生成组合并遵守解锁阶段", () => {
    const rows = entries.filter(
      (row) =>
        row.operator.name === "埃癸斯" && row.meetingCategory === "combo",
    );
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.progression.elite === 2));
    assert.ok(
      rows.every((row) => row.pairedOperators[0].operator.name === "虎狼丸"),
    );
    assert.ok(
      calculate(rows[0]).cluePreferencesByOperator["埃癸斯"].includes(
        "unowned",
      ),
    );
  });

  check("忍冬只在联动技能解锁后生成铃兰组合", () => {
    const rows = entries.filter(
      (row) => row.operator.name === "忍冬" && row.meetingCategory === "combo",
    );
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.progression.elite === 2));
    assert.deepEqual(
      [...new Set(rows.map((row) => row.pairedOperators[0].progression.elite))],
      [0, 1, 2],
    );
  });

  check("没有会客室技能的搭档保留全部可达精英阶段和练度效率", () => {
    const sample = entries.find(
      (row) =>
        row.meetingCategory === "combo" &&
        row.pairedOperators.some(
          ({ operator }) =>
            operator.maxEliteLevel === 2 &&
            !catalog.operators[operator.name]?.skillFile?.chains.some(
              (chain) => chain.room === "meeting",
            ),
        ),
    );
    assert.ok(sample);
    const partnerName = sample.pairedOperators[0].operator.name;
    const rows = entries.filter(
      (row) =>
        row.meetingCategory === "combo" &&
        row.operator.name === sample.operator.name &&
        row.progression.elite === sample.progression.elite &&
        row.progression.level === sample.progression.level &&
        row.pairedOperators[0].operator.name === partnerName,
    );
    assert.deepEqual(
      [...new Set(rows.map((row) => row.pairedOperators[0].progression.elite))],
      [0, 1, 2],
    );
    const efficiencies = rows.map(calculate);
    assert.ok(efficiencies[0].efficiency < efficiencies.at(-1).efficiency);
    assert.ok(
      efficiencies.every(
        (result) => result.operatorSkillEfficiencies[partnerName] === 0,
      ),
    );
  });

  check("全部解锁模式仅保留组合成员最高精英阶段", () => {
    const unlocked = ranking.buildEfficiencyRankingEntries(
      operators,
      catalog,
      true,
    );
    assert.ok(
      unlocked
        .filter((row) => row.meetingCategory === "combo")
        .every((row) =>
          [row, ...row.pairedOperators].every(
            (member) =>
              member.progression.elite === member.operator.maxEliteLevel,
          ),
        ),
    );
  });

  assert.equal(failures.length, 0, `${failures.length} 项效率排名回归失败`);
} finally {
  await vite.close();
}
