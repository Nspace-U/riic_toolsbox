import type {
  EfficiencyCatalog,
  EfficiencyNotice,
  EfficiencyResult,
} from "../types/efficiency";
import type {
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
} from "../types/schedule";
import {
  analyzeSchedulePeriods,
  facilityPower,
  findDuplicateOperators,
  ROOM_LABELS,
  ROOM_ORDER,
} from "./schedule";
import { mapSpecialOperators } from "./specialOperatorMappings";
import { formatDurationHours, formatNumber } from "./presentation";
import { formatFacilityResultLabel } from "./resultPresentation";

export interface EfficiencyNoticeDisplayOption {
  code: string;
  label: string;
  level: EfficiencyNotice["level"];
}

export const EFFICIENCY_NOTICE_DISPLAY_OPTIONS: EfficiencyNoticeDisplayOption[] =
  [
    {
      code: "efficiency-data-error",
      label: "效率数据读取失败",
      level: "error",
    },
    {
      code: "schedule-period-error",
      label: "定时换班时间无效",
      level: "error",
    },
    { code: "missing-skill-data", label: "找不到干员技能数据", level: "error" },
    { code: "negative-power", label: "电力不足", level: "warning" },
    {
      code: "duplicate-operator",
      label: "同一队列存在重复干员",
      level: "warning",
    },
    {
      code: "special-operator-mapping",
      label: "特殊干员没有可用的映射干员",
      level: "warning",
    },
    { code: "maa-drone-target", label: "无人机加速目标无效", level: "warning" },
    { code: "mood-inheritance", label: "发现心情继承异常", level: "warning" },
    {
      code: "mood-work-zero",
      label: "有干员在工作后心情降至 0",
      level: "warning",
    },
    { code: "fiammetta-mood", label: "菲亚梅塔心情恢复提示", level: "warning" },
    {
      code: "schedule-period-gap",
      label: "定时换班存在时间空档",
      level: "info",
    },
    { code: "layout-inferred", label: "本次计算使用了推测布局", level: "info" },
    { code: "maa-drone-overflow", label: "发现无人机爆仓风险", level: "info" },
    {
      code: "mood-auto-rest-no-space",
      label: "宿舍槽位不足，无法自动休整",
      level: "info",
    },
    {
      code: "mood-auto-rest-not-recovered",
      label: "自动休整后心情未达到预期",
      level: "info",
    },
    { code: "overflow-risk", label: "发现爆仓风险", level: "info" },
  ];

export interface EfficiencyNoticeInput {
  catalog?: EfficiencyCatalog;
  document?: ScheduleDocument;
  result?: EfficiencyResult;
  efficiencyError?: string;
}

interface ExtraRoom {
  planName: string;
  type: RoomKey;
  index: number;
  room: RoomAssignment;
}

export function buildEfficiencyNotices(
  input: EfficiencyNoticeInput,
): EfficiencyNotice[] {
  const notices: EfficiencyNotice[] = [];
  const document = input.document;
  const powerSummary = document?.layout?.reduce(
    (summary, entry) => {
      const power = facilityPower(entry.type, entry.level);
      if (power >= 0) {
        summary.provided += power;
      } else {
        summary.used += -power;
      }
      summary.net = summary.provided - summary.used;
      return summary;
    },
    { used: 0, provided: 0, net: 0 },
  ) ?? { used: 0, provided: 0, net: 0 };

  if (powerSummary.net < 0) {
    notices.push({
      code: "negative-power",
      level: "warning",
      message: "电力不足",
      details: [
        `当前布局提供 ${powerSummary.provided} 点电力，消耗 ${powerSummary.used} 点电力，净电力 ${powerSummary.net} 点`,
      ],
    });
  }

  if (input.efficiencyError) {
    notices.push({
      code: "efficiency-data-error",
      level: "error",
      message: "效率数据读取失败",
      details: [input.efficiencyError],
    });
    return notices;
  }

  const periodAnalysis = document
    ? analyzeSchedulePeriods(document)
    : undefined;
  if (periodAnalysis?.errors.length) {
    notices.push({
      code: "schedule-period-error",
      level: "error",
      message: "定时换班时间无效",
      details: periodAnalysis.errors,
    });
    return notices;
  }
  if (periodAnalysis?.warnings.length) {
    notices.push({
      code: "schedule-period-gap",
      level: "info",
      message: "定时换班存在时间空档",
      details: periodAnalysis.warnings,
    });
  }

  const result = input.result;
  if (!result) {
    return notices;
  }
  if (result.layoutSource === "inferred") {
    notices.push({
      code: "layout-inferred",
      level: "info",
      message: "本次计算使用了推测布局",
      details: ["排班表未包含布局，已按队列中的设施自动推测"],
    });
  }

  if (document) {
    const duplicateDetails = findDuplicateOperators(
      document,
      input.catalog?.terms ?? {},
    ).map(({ planIndex, name, locations }) => {
      const plan = document.plans[planIndex];
      return `${plan?.name?.trim() || `队列${planIndex + 1}`}：${name}（${locations.join("、")}）`;
    });
    if (duplicateDetails.length > 0) {
      notices.push({
        code: "duplicate-operator",
        level: "warning",
        message: "同一队列存在重复干员",
        details: duplicateDetails,
      });
    }

    const mappingIssues = mapSpecialOperators(document, input.catalog).issues;
    if (mappingIssues.length > 0) {
      notices.push({
        code: "special-operator-mapping",
        level: "warning",
        message: "特殊干员没有可用的映射干员",
        details: mappingIssues.map((issue) => {
          const plan = document.plans[issue.planIndex];
          return `${plan?.name?.trim() || `队列${issue.planIndex + 1}`} · ${ROOM_LABELS[issue.room]} ${issue.roomIndex + 1} 槽位${issue.slotIndex + 1} · ${issue.name}：${issue.errorMessage}`;
        }),
      });
    }
  }

  const maaDroneWarnings = result.maaDroneAcceleration?.warnings ?? [];
  const droneOverflowDetails = maaDroneWarnings
    .filter((warning) => warning.code === "overflow")
    .map((warning) => warning.message);
  if (droneOverflowDetails.length > 0) {
    notices.push({
      code: "maa-drone-overflow",
      level: "info",
      message: "发现无人机爆仓风险",
      details: droneOverflowDetails,
    });
  }
  const droneTargetDetails = maaDroneWarnings
    .filter((warning) => warning.code !== "overflow")
    .map((warning) => warning.message);
  if (droneTargetDetails.length > 0) {
    notices.push({
      code: "maa-drone-target",
      level: "warning",
      message: "无人机加速目标无效",
      details: droneTargetDetails,
    });
  }
  if (result.warnings.length > 0) {
    notices.push({
      code: "missing-skill-data",
      level: "error",
      message: "找不到干员技能数据",
      details: result.warnings,
    });
  }

  const moodDetails = result.plans.flatMap((plan, planIndex) =>
    plan.moodWarnings.map(
      (warning) =>
        `${plan.name || `队列${planIndex + 1}`} · ${ROOM_LABELS[warning.facility]} ${warning.facilityIndex + 1} · ${warning.operator}：上一队列结束心情 ${formatNumber(warning.previousEnd)}，当前手动设置为 ${formatNumber(warning.configuredStart)}`,
    ),
  );
  if (moodDetails.length > 0) {
    notices.push({
      code: "mood-inheritance",
      level: "warning",
      message: "发现心情继承异常",
      details: moodDetails,
    });
  }

  const workZeroDetails = result.plans.flatMap((plan, planIndex) =>
    plan.moods
      .filter((mood) => mood.working && mood.start > 0 && mood.end === 0)
      .map(
        (mood) =>
          `${plan.name || `队列${planIndex + 1}`} · ${ROOM_LABELS[mood.facility]} ${mood.facilityIndex + 1} · ${mood.operator}：工作后心情从 ${formatNumber(mood.start)} 降至 0`,
      ),
  );
  if (workZeroDetails.length > 0) {
    notices.push({
      code: "mood-work-zero",
      level: "warning",
      message: "有干员在工作后心情降至 0",
      details: workZeroDetails,
    });
  }

  const autoRestDetails = result.plans.flatMap((plan, planIndex) =>
    plan.autoRestWarnings.map((warning) => {
      const dormitory =
        warning.facilityIndex === undefined
          ? ""
          : ` · 宿舍 ${warning.facilityIndex + 1}`;
      const detail =
        warning.reason === "no-space"
          ? `休整前心情 ${formatNumber(warning.startMood)}`
          : `休整后心情 ${formatNumber(warning.endMood)}，低于下次工作预期 ${formatNumber(warning.expectedMood)}（休整前 ${formatNumber(warning.startMood)}）`;
      return {
        detail: `${plan.name || `队列${planIndex + 1}`} · ${warning.operator}${dormitory}：${detail}`,
        reason: warning.reason,
      };
    }),
  );
  const noSpaceAutoRestDetails = autoRestDetails
    .filter((warning) => warning.reason === "no-space")
    .map((warning) => warning.detail);
  if (noSpaceAutoRestDetails.length > 0) {
    notices.push({
      code: "mood-auto-rest-no-space",
      level: "info",
      message: "宿舍槽位不足，无法自动休整",
      details: noSpaceAutoRestDetails,
    });
  }
  const notRecoveredAutoRestDetails = autoRestDetails
    .filter((warning) => warning.reason === "not-recovered")
    .map((warning) => warning.detail);
  if (notRecoveredAutoRestDetails.length > 0) {
    notices.push({
      code: "mood-auto-rest-not-recovered",
      level: "info",
      message: "自动休整后心情未达到预期",
      details: notRecoveredAutoRestDetails,
    });
  }

  if (result.fiammettaWarnings.length > 0) {
    const directMode = result.fiammetta?.mode === "direct";
    notices.push({
      code: "fiammetta-mood",
      level: "warning",
      message: directMode
        ? "菲亚梅塔无法完全恢复这些干员心情"
        : "发现菲亚梅塔心情恢复异常",
      details: directMode ? [] : result.fiammettaWarnings,
    });
  }

  const overflowDetails = result.plans.flatMap((plan, planIndex) =>
    plan.facilities.flatMap((facility) => {
      const production = facility.production;
      if (!production?.overflowed || production.breachTime === undefined) {
        return [];
      }
      const operators =
        facility.facility.type === "power"
          ? plan.moods
              .filter((mood) => mood.facility === "power")
              .map((mood) => mood.operator)
          : plan.moods
              .filter((mood) => mood.facilityId === facility.facility.id)
              .map((mood) => mood.operator);
      const timing =
        production.breachTime <= 0
          ? "将立即爆仓"
          : `将在工作 ${formatDurationHours(production.breachTime)}后爆仓`;
      return [
        `${plan.name || `队列${planIndex + 1}`} · ${formatFacilityResultLabel(facility, document?.layout ?? [])} · ${operators.join("、") || "无干员"}：${timing}`,
      ];
    }),
  );
  if (overflowDetails.length > 0) {
    notices.push({
      code: "overflow-risk",
      level: "info",
      message: "发现爆仓风险",
      details: overflowDetails,
    });
  }

  return notices;
}

export function buildImportedExtraRoomsNotice(
  document: ScheduleDocument,
): EfficiencyNotice | undefined {
  const extraRooms: ExtraRoom[] = document.plans.flatMap((plan, planIndex) =>
    ROOM_ORDER.flatMap((type) => {
      const rooms = plan.rooms[type];
      if (!Array.isArray(rooms)) {
        return [];
      }
      const expected = document.layout.filter(
        (entry) => entry.type === type,
      ).length;
      return rooms.slice(expected).map((room, offset) => ({
        planName: plan.name || `队列${planIndex + 1}`,
        type,
        index: expected + offset,
        room: room as RoomAssignment,
      }));
    }),
  );
  if (extraRooms.length === 0) {
    return undefined;
  }

  return {
    code: "import-extra-rooms",
    level: "error",
    message: "导入排班表包含未登记设施实例",
    details: extraRooms.map((item) => {
      const operators = item.room.operators?.filter((name) => Boolean(name));
      const operatorDetail = operators?.length
        ? `：${operators.join("、")}`
        : "";
      return `${item.planName} · ${ROOM_LABELS[item.type]} ${item.index + 1}${operatorDetail}`;
    }),
    closable: true,
  };
}
