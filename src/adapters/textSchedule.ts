import type {
  ParsedSchedule,
  Plan,
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
} from "@/types/schedule";
import { ROOM_KEYS } from "@/types/schedule";
import { ScheduleError } from "@/utils/schedule";
import {
  completeInferredRooms,
  inferScheduleLayout,
} from "@/utils/importLayout";

interface ParsedOperator {
  name: string;
  state?: { elite?: number; mood?: number };
}

interface ParsedQueue {
  operators: ParsedOperator[];
  description: string;
}

interface ParsedStation {
  title: string;
  type: RoomKey | "processing-training";
  product?: string;
  queues: ParsedQueue[];
}

const PRODUCT_BY_LABEL: Record<string, string> = {
  中级作战记录: "Battle Record",
  作战记录: "Battle Record",
  赤金: "Pure Gold",
  源石碎片: "Originium Shard",
  合成玉: "Orundum",
};

function nonEmptyLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseOperatorToken(token: string): ParsedOperator {
  let value = token.trim();
  const mood = value.endsWith("!") ? 0 : undefined;
  if (mood !== undefined) {
    value = value.slice(0, -1);
  }
  const last = value.at(-1);
  const elite = last && /[012]/.test(last) ? Number(last) : undefined;
  if (elite !== undefined) {
    value = value.slice(0, -1);
  }
  if (!value) {
    throw new ScheduleError("TXT 排班表包含空的干员名称");
  }
  return {
    name: value,
    ...(elite !== undefined || mood !== undefined
      ? {
          state: {
            ...(elite !== undefined ? { elite } : {}),
            ...(mood !== undefined ? { mood } : {}),
          },
        }
      : {}),
  };
}

function parseQueue(text: string): ParsedQueue {
  const [operatorText, ...descriptionParts] = text.split("|");
  const operators = (operatorText ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(parseOperatorToken);
  return {
    operators,
    description: descriptionParts.join("|").trim(),
  };
}

function stationInfo(title: string): {
  type: RoomKey | "processing-training";
  product?: string;
} {
  const normalized = title.replace(/（[^）]*）/g, "").trim();
  if (normalized === "加工站 / 训练室") {
    return { type: "processing-training" };
  }
  const stationTypes: RoomKey[] = [
    "control",
    "trading",
    "manufacture",
    "power",
    "meeting",
    "hire",
    "processing",
    "training",
    "dormitory",
  ];
  const type = stationTypes.find((candidate: RoomKey) =>
    title.startsWith(
      {
        control: "控制中枢",
        trading: "贸易站",
        manufacture: "制造站",
        power: "发电站",
        meeting: "会客室",
        hire: "办公室",
        processing: "加工站",
        training: "训练室",
        dormitory: "宿舍",
      }[candidate],
    ),
  );
  if (!type) {
    throw new ScheduleError(`无法识别设施“${title}”`);
  }
  const productLabel = title.match(/（([^）]+)）/)?.[1];
  return {
    type,
    ...(productLabel && PRODUCT_BY_LABEL[productLabel]
      ? { product: PRODUCT_BY_LABEL[productLabel] }
      : type === "trading"
        ? { product: "LMD" }
        : type === "manufacture"
          ? { product: "Pure Gold" }
          : {}),
  };
}

function parseStation(text: string): ParsedStation {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim());
  while (lines[0] === "") {
    lines.shift();
  }
  while (lines.at(-1) === "") {
    lines.pop();
  }
  const title = lines[0] ?? "";
  if (!title || !lines[1]) {
    throw new ScheduleError("TXT 排班表中的设施块缺少名称或类型");
  }
  const info = stationInfo(title);
  return {
    title,
    type: info.type,
    product: info.product,
    queues: lines.slice(2).map(parseQueue),
  };
}

function parseHours(text: string | undefined): number {
  const value = Number(text?.match(/\d+(?:\.\d+)?/)?.[0] ?? 12);
  return Math.max(1, Math.round(value * 60));
}

function parseFiammetta(line: string | undefined): string[] {
  const match = line?.match(/^菲亚梅塔\s*007(?:\s+(.+))?$/);
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split(/[、,，/]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function appendRoom(
  plan: Plan,
  type: RoomKey,
  queue: ParsedQueue | undefined,
  product: string | undefined,
): void {
  const room: RoomAssignment = {};
  const operators = queue?.operators ?? [];
  if (operators.length > 0) {
    room.operators = operators.map(({ name }) => name);
    const operatorStates = Object.fromEntries(
      operators.flatMap(({ name, state }) => (state ? [[name, state]] : [])),
    );
    if (Object.keys(operatorStates).length > 0) {
      room.operatorStates = operatorStates;
    }
  }
  if (product) {
    room.product = product;
  }
  if (queue?.description) {
    room.description = queue.description;
  }
  const rooms = Array.isArray(plan.rooms[type])
    ? [...(plan.rooms[type] as RoomAssignment[])]
    : [];
  rooms.push(room);
  plan.rooms[type] = rooms;
}

function buildPlans(
  stations: ParsedStation[],
  queueDescriptions: string[],
  stats: string,
): Plan[] {
  const queueCount = Math.max(
    queueDescriptions.length,
    ...stations.map((station) => station.queues.length),
    1,
  );
  return Array.from({ length: queueCount }, (_, queueIndex) => {
    const plan: Plan = {
      name: `队列${queueIndex + 1}`,
      duration: parseHours(queueDescriptions[queueIndex]),
      description: stats,
      rooms: {},
    };
    stations.forEach((station) => {
      const queue = station.queues[queueIndex];
      if (station.type === "processing-training") {
        const operators = queue?.operators ?? [];
        appendRoom(
          plan,
          "processing",
          {
            operators: operators.slice(0, 1),
            description: queue?.description ?? "",
          },
          undefined,
        );
        appendRoom(
          plan,
          "training",
          {
            operators: operators.slice(1),
            description: queue?.description ?? "",
          },
          undefined,
        );
        return;
      }
      appendRoom(plan, station.type, queue, station.product);
    });
    return plan;
  });
}

export function parseTextSchedule(text: string): ParsedSchedule {
  const sections = text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/^\s*-=-\s*$/m);
  if (sections.length < 3) {
    throw new ScheduleError("文件不是支持的排班 TXT 格式");
  }
  const titleLines = nonEmptyLines(sections[0] ?? "");
  const detailsLines = nonEmptyLines(sections[1] ?? "");
  const bodyLines = nonEmptyLines(sections.slice(2).join("\n-=-\n"));
  const stats = bodyLines.shift() ?? "";
  const queueDescriptions = (bodyLines.shift() ?? "")
    .split("|")
    .map((value) => value.trim());
  const stationText = bodyLines.join("\n");
  const stations = stationText.split(/^\s*={3,}\s*$/m).flatMap((block) =>
    block
      .split(/^\s*-{3,}\s*$/m)
      .map((station) => station.trim())
      .filter(Boolean)
      .map(parseStation),
  );
  if (stations.length === 0) {
    throw new ScheduleError("TXT 排班表没有设施内容");
  }
  const plans = buildPlans(stations, queueDescriptions, stats);
  const layout = inferScheduleLayout(plans);
  const fiammettaLine = detailsLines.find((line) => line.includes("菲亚梅塔"));
  const fiammettaTargets = parseFiammetta(fiammettaLine);
  const document: ScheduleDocument = {
    title: titleLines.join(" · ") || "导入排班表",
    description: detailsLines
      .filter((line) => line !== fiammettaLine)
      .join(" "),
    layout,
    plans: completeInferredRooms(plans, layout),
    settings: {
      fiammettaMode: "direct",
      fiammettaDirectCount: Math.max(3, fiammettaTargets.length),
    },
    ...(fiammettaTargets.length > 0
      ? {
          fiammetta: { direct: { operators: fiammettaTargets } },
          importFiammetta: true,
        }
      : {}),
  };
  return { document, inferredLayout: true };
}

export function isTextSchedule(text: string): boolean {
  return !text.trimStart().startsWith("{");
}

export function supportedTextRoomKeys(): readonly RoomKey[] {
  return ROOM_KEYS;
}
