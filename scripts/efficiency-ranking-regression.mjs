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

  check("宿舍按效率包分类并保持指定展示顺序", () => {
    const entryFor = (name, elite) =>
      entries.find(
        (row) =>
          row.operator.name === name &&
          row.facility === "dormitory" &&
          row.progression.elite === elite,
      );
    const bordenko = entryFor("波登可", 1);
    const iceWine = entryFor("冰酿", 2);
    const senshi = entryFor("森西", 0);
    const perfumer = entryFor("撷英调香师", 2);
    assert.ok(bordenko.dormitoryCategories.includes("shared"));
    assert.ok(bordenko.dormitoryCategories.includes("single"));
    assert.deepEqual(iceWine.dormitoryCategories, ["spread"]);
    assert.ok(senshi.dormitoryCategories.includes("shared"));
    assert.ok(!senshi.dormitoryCategories.includes("single"));
    assert.ok(perfumer.dormitoryCategories.includes("specific"));
    assert.deepEqual(
      ["shared", "single", "spread", "specific", "self"].map((type) =>
        ranking.dormitoryRecoveryLabel(type),
      ),
      ["群体恢复", "单体恢复", "分摊恢复", "特定恢复", "自身恢复"],
    );
  });

  check("宿舍固定恢复与线性增量正确叠加", () => {
    for (const [name, value] of [
      ["隐德来希", 0.3],
      ["流明", 0.3],
      ["响石", 0.25],
    ]) {
      const entry = entries.find(
        (row) =>
          row.operator.name === name &&
          row.facility === "dormitory" &&
          row.progression.elite === 2,
      );
      assert.ok(entry);
      assert.ok(
        Math.abs(
          ranking.dormitoryRecoveryEffectValueForCategory(
            calculate(entry).dormitoryRecoveryByOperator[name],
            "shared",
          ) - value,
        ) < 1e-9,
      );
    }
    for (const [name, operator] of Object.entries(catalog.operators)) {
      operator.skillFile.chains
        .filter((chain) => chain.room === "dormitory")
        .forEach((chain) =>
          chain.stages.forEach((stage, stageIndex) =>
            stage.effects.forEach((effect, effectIndex) => {
              if (effect.baseValue === undefined || !effect.per) return;
              const entry = entries.find(
                (row) =>
                  row.operator.name === name &&
                  row.facility === "dormitory" &&
                  row.progression.elite === stage.unlock.value,
              );
              assert.ok(entry);
              const changed = structuredClone(catalog);
              const changedChain = changed.operators[name].skillFile.chains
                .filter((item) => item.room === "dormitory")
                .find((item) => item.slot === chain.slot);
              delete changedChain.stages[stageIndex].effects[effectIndex]
                .baseValue;
              const withBase = ranking.dormitoryRecoveryEffectValueForCategory(
                calculate(entry).dormitoryRecoveryByOperator[name],
                "shared",
              );
              const withoutBase =
                ranking.dormitoryRecoveryEffectValueForCategory(
                  calculate(entry, changed).dormitoryRecoveryByOperator[name],
                  "shared",
                );
              assert.ok(
                Math.abs(withBase - withoutBase - effect.baseValue) < 1e-9,
                `${name} ${stage.name}`,
              );
            }),
          ),
        );
    }
  });

  check("宿舍恢复分组只取对应类型，其他技能值和特定条件保留在备注", () => {
    const contributions = [
      { operator: "波登可", value: 0.15, distribution: "shared" },
      { operator: "波登可", value: 0.65, distribution: "single" },
    ];
    assert.equal(
      ranking.dormitoryRecoveryValueForCategory(contributions, "shared"),
      0.15,
    );
    assert.equal(
      ranking.dormitoryRecoveryValueForCategory(contributions, "single"),
      0.65,
    );
    assert.equal(
      ranking.dormitoryRecoveryValueForCategory(contributions, "spread"),
      undefined,
    );
    const bordenko = entries.find(
      (row) =>
        row.operator.name === "波登可" &&
        row.facility === "dormitory" &&
        row.progression.elite === 1,
    );
    const bordenkoResult = calculate(bordenko);
    const bordenkoContributions =
      bordenkoResult.dormitoryRecoveryContributionsByOperator["波登可"];
    assert.equal(
      ranking.dormitoryRecoveryValueForCategory(
        bordenkoContributions,
        "shared",
      ),
      0.15,
    );
    assert.equal(
      ranking.dormitoryRecoveryValueForCategory(
        bordenkoContributions,
        "single",
      ),
      undefined,
    );
    assert.equal(
      ranking.dormitoryRecoveryEffectValueForCategory(
        bordenkoResult.dormitoryRecoveryByOperator["波登可"],
        "single",
      ),
      0.65,
    );
    const iceWine = entries.find(
      (row) =>
        row.operator.name === "冰酿" &&
        row.facility === "dormitory" &&
        row.progression.elite === 2,
    );
    const iceWineResult = calculate(iceWine);
    assert.equal(
      ranking.dormitoryRecoveryValueForCategory(
        iceWineResult.dormitoryRecoveryContributionsByOperator["冰酿"],
        "spread",
      ),
      undefined,
    );
    assert.equal(
      ranking.dormitoryRecoveryEffectValueForCategory(
        iceWineResult.dormitoryRecoveryByOperator["冰酿"],
        "spread",
      ),
      0.8,
    );
    const perfumer = entries.find(
      (row) =>
        row.operator.name === "撷英调香师" &&
        row.facility === "dormitory" &&
        row.progression.elite === 2,
    );
    const perfumerResult = calculate(perfumer);
    assert.equal(
      ranking.dormitoryRecoveryValueForCategory(
        perfumerResult.dormitoryRecoveryContributionsByOperator["撷英调香师"],
        "specific",
      ),
      undefined,
    );
    assert.equal(
      ranking.dormitoryRecoveryEffectValueForCategory(
        perfumerResult.dormitoryRecoveryByOperator["撷英调香师"],
        "specific",
      ),
      0.1,
    );
    assert.match(
      ranking.defaultEfficiencyRankingNote(perfumer, catalog),
      /特定恢复条件：目标心情需低于20，恢复效果额外\+0\.1\/小时/,
    );
  });

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
      (row) =>
        row.meetingCategory === "combo" &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes("忍冬") &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes("铃兰"),
    );
    assert.ok(rows.length > 0);
    assert.ok(
      rows.every(
        (row) =>
          [row, ...row.pairedOperators].find(
            ({ operator }) => operator.name === "忍冬",
          ).progression.elite === 2,
      ),
    );
    assert.deepEqual(
      [
        ...new Set(
          rows.map(
            (row) =>
              [row, ...row.pairedOperators].find(
                ({ operator }) => operator.name === "铃兰",
              ).progression.elite,
          ),
        ),
      ],
      [0, 1, 2],
    );
  });

  check("凛视和提丰的双向条件只生成一次，且练度搭配仍分别保留", () => {
    const rows = entries.filter(
      (row) =>
        row.meetingCategory === "combo" &&
        new Set([
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ]).size === 2 &&
        [row.operator.name, row.pairedOperators[0].operator.name].includes(
          "凛视",
        ) &&
        [row.operator.name, row.pairedOperators[0].operator.name].includes(
          "提丰",
        ),
    );
    const identities = rows.map((row) =>
      [row, ...row.pairedOperators]
        .map(
          ({ operator, progression }) =>
            `${operator.id}:${progression.elite}:${progression.level}`,
        )
        .sort()
        .join("+"),
    );
    assert.ok(rows.length > 0);
    assert.equal(new Set(identities).size, rows.length);
    assert.ok(
      rows.every(
        (row) =>
          row.operator.id.localeCompare(row.pairedOperators[0].operator.id) < 0,
      ),
    );
    assert.ok(
      new Set(rows.map((row) => row.pairedOperators[0].progression.elite))
        .size > 1,
    );
  });

  check("阵营派生过滤无会客技能成员，明确点名搭档仍保留练度", () => {
    assert.equal(
      entries.some(
        (row) =>
          row.meetingCategory === "combo" &&
          [
            row.operator.name,
            ...row.pairedOperators.map(({ operator }) => operator.name),
          ].includes("提丰") &&
          [
            row.operator.name,
            ...row.pairedOperators.map(({ operator }) => operator.name),
          ].includes("柏喙"),
      ),
      false,
    );
    const explicitRows = entries.filter(
      (row) =>
        row.meetingCategory === "combo" &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes("忍冬") &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes("铃兰"),
    );
    assert.ok(
      explicitRows.some((row) =>
        [row, ...row.pairedOperators].some(
          ({ operator }) =>
            !catalog.operators[operator.name]?.skillFile?.chains.some(
              (chain) => chain.room === "meeting",
            ),
        ),
      ),
    );
  });

  check("没有会客室技能的搭档保留全部可达精英阶段和练度效率", () => {
    const changed = structuredClone(catalog);
    const changeLeader = "忍冬";
    const partnerName = "柏喙";
    const meetingEffect = changed.operators[changeLeader].skillFile.chains
      .find((chain) => chain.room === "meeting")
      .stages.flatMap((stage) => stage.effects)
      .find((effect) => effect.target === "meeting");
    meetingEffect.condition = {
      type: "opAtFacility",
      op: partnerName,
      facility: "same",
      other: true,
    };
    const changedEntries = ranking.buildEfficiencyRankingEntries(
      operators,
      changed,
    );
    const sample = changedEntries.find(
      (row) =>
        row.meetingCategory === "combo" &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes(changeLeader) &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes(partnerName),
    );
    assert.ok(sample);
    const leaderProgression = [sample, ...sample.pairedOperators].find(
      ({ operator }) => operator.name === changeLeader,
    ).progression;
    const rows = changedEntries.filter(
      (row) =>
        row.meetingCategory === "combo" &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes(changeLeader) &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes(partnerName) &&
        [row, ...row.pairedOperators].some(
          ({ operator, progression }) =>
            operator.name === changeLeader &&
            progression.elite === leaderProgression.elite &&
            progression.level === leaderProgression.level,
        ),
    );
    assert.deepEqual(
      [
        ...new Set(
          rows.map(
            (row) =>
              [row, ...row.pairedOperators].find(
                ({ operator }) => operator.name === partnerName,
              ).progression.elite,
          ),
        ),
      ],
      [0, 1, 2],
    );
    const efficiencies = rows.map((row) => calculate(row, changed));
    assert.ok(efficiencies[0].efficiency < efficiencies.at(-1).efficiency);
    assert.ok(
      efficiencies.every(
        (result) => result.operatorSkillEfficiencies[partnerName] === 0,
      ),
    );
  });

  check("闪击按基建点类型生成独立效率行并分别计算", () => {
    const rows = entries.filter(
      (row) =>
        row.operator.name === "闪击" &&
        row.facility === "hire" &&
        row.progression.elite === 2 &&
        row.basePointScenarios,
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => Object.values(row.basePointScenarios)[0]).sort(),
      ["cc.bd_ash", "cc.bd_tachanka"],
    );
    rows.forEach((row) => {
      const scenarioTerm = Object.values(row.basePointScenarios)[0];
      const otherTerm = ["cc.bd_ash", "cc.bd_tachanka"].find(
        (term) => term !== scenarioTerm,
      );
      const note = ranking.defaultEfficiencyRankingNote(row, catalog);
      assert.match(note, /增益取决于/);
      assert.equal((note.match(/增益取决于/g) ?? []).length, 1);
      assert.match(note, new RegExp(catalog.terms[scenarioTerm].name));
      const unsupportedSchedule = ranking.createEfficiencyRankingSchedule(row, {
        layout,
        workHours: 24,
        clueExchanging: true,
        treatSkillsAsUnlocked: false,
        dormitoryDefaultIncludesMoodRecovery: false,
        catalog,
      });
      Object.values(unsupportedSchedule.plans[0].rooms).forEach(
        (assignments) => {
          if (!Array.isArray(assignments)) return;
          assignments.forEach((assignment) => {
            assignment.operators = (assignment.operators ?? []).filter(
              (name) => !["灰烬", "战车"].includes(name),
            );
          });
        },
      );
      const unmet = ranking.calculateEfficiencyRankingEntry(catalog, {
        ...row,
        schedule: unsupportedSchedule,
      });
      assert.ok(
        unmet.notes.some((item) =>
          item.includes(catalog.terms[scenarioTerm].name),
        ),
      );
      assert.ok(
        unmet.notes.every(
          (item) => !item.includes(catalog.terms[otherTerm].name),
        ),
      );
    });
    const scenarioCatalog = structuredClone(catalog);
    for (const [name, term, value] of [
      ["芬", "cc.bd_ash", 2],
      ["香草", "cc.bd_tachanka", 1],
    ]) {
      scenarioCatalog.operators[name].skillFile.chains.push({
        slot: 99,
        room: "control",
        stages: [
          {
            unlock: { type: "elite", value: 0 },
            name: "测试点数",
            effects: [{ target: "any", stat: "basePointGain", term, value }],
          },
        ],
      });
    }
    const results = rows.map((row) => {
      const schedule = ranking.createEfficiencyRankingSchedule(row, {
        layout,
        workHours: 24,
        clueExchanging: true,
        treatSkillsAsUnlocked: false,
        dormitoryDefaultIncludesMoodRecovery: false,
        catalog: scenarioCatalog,
      });
      schedule.plans[0].rooms.control[0].operators = ["芬", "香草"];
      return ranking.calculateEfficiencyRankingEntry(scenarioCatalog, {
        ...row,
        schedule,
      });
    });
    assert.notEqual(results[0].efficiency, results[1].efficiency);
    assert.deepEqual(
      results.map((result) => result.efficiency),
      [30, 25],
    );
  });

  check("闪击两种基建点行分别放入对应控制中枢支援", () => {
    const rows = entries.filter(
      (row) =>
        row.operator.name === "闪击" &&
        row.facility === "hire" &&
        row.progression.elite === 2 &&
        row.basePointScenarios,
    );
    for (const row of rows) {
      const scenarioTerm = row.basePointScenarios[row.operator.id];
      const schedule = ranking.createEfficiencyRankingSchedule(row, {
        layout,
        workHours: 24,
        clueExchanging: true,
        treatSkillsAsUnlocked: false,
        dormitoryDefaultIncludesMoodRecovery: false,
        catalog,
      });
      const operators = schedule.plans[0].rooms.control[0].operators;
      if (scenarioTerm === "cc.bd_ash") {
        assert.ok(operators.includes("灰烬"));
        assert.equal(operators.filter((name) => name === "彩虹小队").length, 4);
        assert.ok(!operators.includes("战车"));
        assert.ok(!operators.includes("乌萨斯学生自治团"));
      } else {
        assert.equal(scenarioTerm, "cc.bd_tachanka");
        assert.ok(operators.includes("战车"));
        assert.equal(
          operators.filter((name) => name === "乌萨斯学生自治团").length,
          4,
        );
        assert.ok(!operators.includes("灰烬"));
        assert.ok(!operators.includes("彩虹小队"));
      }
    }
  });

  check("余和纯烬按解锁练度配置宿舍群体成员", () => {
    const yu = entries.find(
      (row) =>
        row.operator.name === "余" &&
        row.facility === "dormitory" &&
        row.progression.elite === 0,
    );
    const yuSchedule = ranking.createEfficiencyRankingSchedule(yu, {
      layout,
      workHours: 24,
      clueExchanging: true,
      treatSkillsAsUnlocked: false,
      dormitoryDefaultIncludesMoodRecovery: false,
      catalog,
    });
    assert.equal(
      yuSchedule.plans[0].rooms.dormitory[0].operators.filter(
        (name) => name === "岁",
      ).length,
      3,
    );

    const goatRows = entries.filter(
      (row) =>
        row.operator.name === "纯烬艾雅法拉" && row.facility === "dormitory",
    );
    for (const row of goatRows) {
      const schedule = ranking.createEfficiencyRankingSchedule(row, {
        layout,
        workHours: 24,
        clueExchanging: true,
        treatSkillsAsUnlocked: false,
        dormitoryDefaultIncludesMoodRecovery: false,
        catalog,
      });
      const count = schedule.plans[0].rooms.dormitory[0].operators.filter(
        (name) => name === "行医",
      ).length;
      assert.equal(count, row.progression.elite === 2 ? 3 : 0);
    }
  });

  check("赤刃明霄陈的默认招募支援提供人间烟火点数", () => {
    const entry = entries.find(
      (row) =>
        row.operator.name === "赤刃明霄陈" &&
        row.facility === "meeting" &&
        row.progression.elite === 2,
    );
    assert.ok(entry);
    const schedule = ranking.createEfficiencyRankingSchedule(entry, {
      layout,
      workHours: 24,
      clueExchanging: true,
      treatSkillsAsUnlocked: false,
      dormitoryDefaultIncludesMoodRecovery: false,
      catalog,
    });
    assert.ok(schedule.plans[0].rooms.hire[0].operators.includes("桑葚"));
    assert.ok(!schedule.plans[0].rooms.hire[0].operators.includes("絮雨"));
  });

  check("行医术语以可读名称和干员列表显示", () => {
    assert.equal(catalog.terms["cc.c.clinician"].name, "行医");
    assert.ok(catalog.terms["cc.c.clinician"].members.includes("纯烬艾雅法拉"));
    const entry = entries.find(
      (row) =>
        row.operator.name === "纯烬艾雅法拉" && row.facility === "dormitory",
    );
    assert.match(ranking.defaultEfficiencyRankingNote(entry, catalog), /行医/);
    assert.doesNotMatch(
      ranking.defaultEfficiencyRankingNote(entry, catalog),
      /cc\.c\.clinician/,
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
    const combo = entries.find(
      (row) =>
        row.meetingCategory === "combo" &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes("忍冬") &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes("铃兰") &&
        [row, ...row.pairedOperators].find(
          ({ operator }) => operator.name === "忍冬",
        ).progression.elite === 2,
    );
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
      (row) =>
        row.meetingCategory === "combo" &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes("忍冬") &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes("铃兰"),
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
      (row) =>
        row.meetingCategory === "combo" &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes("忍冬") &&
        [
          row.operator.name,
          ...row.pairedOperators.map(({ operator }) => operator.name),
        ].includes("铃兰"),
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
      JSON.stringify({
        members: [
          combo.operator.name,
          ...combo.pairedOperators.map(({ operator }) => operator.name),
        ],
        notes: result.notes,
      }),
    );
  });

  assert.equal(failures.length, 0, `${failures.length} 项效率排名回归失败`);
} finally {
  await vite.close();
}
