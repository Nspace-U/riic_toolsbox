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
  const entries = ranking.buildEfficiencyRankingEntries(operators, catalog);
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

  function calculate(entry, currentCatalog = catalog, savedRooms) {
    return ranking.calculateEfficiencyRankingEntry(currentCatalog, {
      ...entry,
      schedule: ranking.createEfficiencyRankingSchedule(entry, {
        layout,
        workHours: 24,
        clueExchanging: true,
        treatSkillsAsUnlocked: false,
        dormitoryDefaultIncludesMoodRecovery: false,
        catalog: currentCatalog,
        savedRooms,
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
    const efficiencies = rows.map((row) => calculate(row));
    assert.ok(efficiencies[0].efficiency < efficiencies.at(-1).efficiency);
    assert.ok(
      efficiencies.every(
        (result) => result.operatorSkillEfficiencies[partnerName] === 0,
      ),
    );
  });

  check("全部解锁模式在计算后选择最高练度的结果", () => {
    const combos = entries.filter((row) => row.meetingCategory === "combo");
    const unlocked = ranking.selectEfficiencyRankingRows(
      combos.map((row) => ({ ...row, result: calculate(row) })),
      true,
    );
    assert.ok(unlocked.length > 0);
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

  check("不影响本人发电效率的技能不生成前置条件备注", () => {
    for (const [name, irrelevant] of [
      ["承曦格雷伊", /作业平台/],
      ["正义骑士号", /野鬃/],
    ]) {
      const entry = entries.findLast(
        (row) => row.operator.name === name && row.facility === "power",
      );
      assert.ok(entry);
      assert.doesNotMatch(
        ranking.defaultEfficiencyRankingNote(entry, catalog),
        irrelevant,
      );
      assert.ok(calculate(entry).notes.every((note) => !irrelevant.test(note)));
    }
  });

  check("会客室组合隐藏明确搭档的进驻条件，单人行仍保留", () => {
    const rows = entries.filter(
      (row) =>
        row.operator.name === "忍冬" &&
        row.facility === "meeting" &&
        row.progression.elite === 2,
    );
    const single = rows.find((row) => row.meetingCategory !== "combo");
    const combo = rows.find((row) => row.meetingCategory === "combo");
    assert.match(ranking.defaultEfficiencyRankingNote(single, catalog), /铃兰/);
    assert.doesNotMatch(
      ranking.defaultEfficiencyRankingNote(combo, catalog),
      /需要铃兰进驻/,
    );
  });

  check("默认支援不能隐藏 GALLUS² 的有效条件", () => {
    const entry = entries.findLast(
      (row) =>
        row.operator.id === "char_4227_gallus" && row.facility === "power",
    );
    assert.ok(entry);
    assert.match(
      ranking.defaultEfficiencyRankingNote(entry, catalog),
      /其他.*作业平台.*进驻/,
    );
  });

  check("独立干员条件准确区分工作干员和零心情进驻干员", () => {
    const entry = entries.findLast(
      (row) =>
        row.operator.name === "予愿安洁莉娜" && row.facility === "meeting",
    );
    assert.ok(entry);
    assert.match(
      ranking.defaultEfficiencyRankingNote(entry, catalog),
      /同设施不能有其他心情大于0的工作干员/,
    );
  });

  check("相同发电结果合并到最低练度，包括全部解锁模式", () => {
    for (const name of ["承曦格雷伊", "正义骑士号"]) {
      const rows = entries
        .filter((row) => row.operator.name === name && row.facility === "power")
        .map((row) => ({ ...row, result: calculate(row) }));
      assert.ok(rows.length > 1);
      for (const unlocked of [false, true]) {
        const selected = ranking.selectEfficiencyRankingRows(rows, unlocked);
        assert.equal(selected.length, 1);
        assert.equal(selected[0].progression.elite, 0);
        assert.equal(selected[0].progression.level, 1);
      }
    }
  });

  check("最高结果平台取最低练度，心情和线索倾向差异仍分别保留", () => {
    const changed = structuredClone(catalog);
    const name = "承曦格雷伊";
    const skillFile = changed.operators[name].skillFile;
    skillFile.chains = [
      {
        slot: 1,
        room: "power",
        stages: [25, 30, 30].map((value, elite) => ({
          unlock: { type: "elite", value: elite },
          name: `阶段${elite}`,
          effects: [{ target: "power", stat: "droneCharge", value }],
        })),
      },
    ];
    function rowsForChangedCatalog() {
      return ranking
        .buildEfficiencyRankingEntries(operators, changed)
        .filter((row) => row.operator.name === name && row.facility === "power")
        .map((row) => ({ ...row, result: calculate(row, changed) }));
    }
    const rows = rowsForChangedCatalog();
    assert.deepEqual(
      ranking
        .selectEfficiencyRankingRows(rows, false)
        .map((row) => row.progression.elite),
      [0, 1],
    );
    assert.deepEqual(
      ranking
        .selectEfficiencyRankingRows(rows, true)
        .map((row) => row.progression.elite),
      [1],
    );
    skillFile.chains[0].stages[2].effects.push({
      target: "power",
      stat: "moodCost",
      value: -0.5,
    });
    assert.deepEqual(
      ranking
        .selectEfficiencyRankingRows(rowsForChangedCatalog(), false)
        .map((row) => row.progression.elite),
      [0, 1, 2],
    );
    const clueRows = rows.map((row) => ({
      ...row,
      result: {
        ...row.result,
        cluePreferencesByOperator: {
          [name]: row.progression.elite === 2 ? [1] : [],
        },
      },
    }));
    assert.equal(
      ranking.selectEfficiencyRankingRows(clueRows, false).length,
      3,
    );
  });

  check("会客室组合保留外部支援、线索交流、人数和暖机要求", () => {
    const changed = structuredClone(catalog);
    const combo = entries.find(
      (row) => row.operator.name === "忍冬" && row.meetingCategory === "combo",
    );
    const effects =
      changed.operators["忍冬"].skillFile.chains[1].stages[0].effects;
    effects.push(
      {
        target: "meeting",
        stat: "clueSpeed",
        value: 5,
        condition: {
          type: "opAtFacility",
          op: "铃兰",
          facility: "manufacture",
        },
      },
      {
        target: "meeting",
        stat: "clueSpeed",
        value: 5,
        condition: { type: "clueExchanging" },
      },
      {
        target: "meeting",
        stat: "clueSpeed",
        value: 5,
        condition: {
          type: "opGroupCountInFacility",
          group: "cc.g.rh",
          facility: "same",
          min: 2,
        },
      },
      {
        target: "meeting",
        stat: "clueSpeed",
        curve: { type: "ramp", startValue: 0, cap: 10, step: 5 },
      },
    );
    const note = ranking.defaultEfficiencyRankingNote(combo, changed);
    assert.doesNotMatch(note, /需要铃兰进驻会客室/);
    assert.match(note, /需要铃兰进驻制造站/);
    assert.match(note, /需要开启线索交流/);
    assert.match(note, /至少2名/);
    assert.match(note, /2小时暖机/);
  });

  check("组合编辑后移除搭档仍提示未满足的联动条件", () => {
    const combo = entries.find(
      (row) => row.operator.name === "忍冬" && row.meetingCategory === "combo",
    );
    const schedule = ranking.createEfficiencyRankingSchedule(combo, {
      layout,
      workHours: 24,
      clueExchanging: true,
      treatSkillsAsUnlocked: false,
      dormitoryDefaultIncludesMoodRecovery: false,
      catalog,
    });
    schedule.plans[0].rooms.meeting[0].operators = ["忍冬"];
    const result = ranking.calculateEfficiencyRankingEntry(catalog, {
      ...combo,
      schedule,
    });
    assert.ok(
      result.notes.some((note) => /条件未满足：需要铃兰进驻会客室/.test(note)),
    );
  });

  assert.equal(failures.length, 0, `${failures.length} 项效率排名回归失败`);
} finally {
  await vite.close();
}
