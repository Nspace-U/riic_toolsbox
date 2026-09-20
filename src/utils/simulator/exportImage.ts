import { toSvg } from "html-to-image";

import type { EliteLevel, Operator } from "@/types/baseData";
import type { RoomKey, ScheduleDocument } from "@/types/schedule";
import { getOperatorAvatarLayerSources } from "@/utils/operatorAvatar";
import {
  formatDurationHours,
  planDurationHoursValue,
} from "@/utils/simulator/presentation";

export const SCHEDULE_IMAGE_RESOLUTIONS = [
  { key: "1080p", label: "1920 × 1080", width: 1920, height: 1080 },
  { key: "2k", label: "2560 × 1440", width: 2560, height: 1440 },
  { key: "4k", label: "3840 × 2160", width: 3840, height: 2160 },
] as const;

export type ScheduleImageResolutionKey =
  (typeof SCHEDULE_IMAGE_RESOLUTIONS)[number]["key"];

export type ScheduleImageResolution =
  (typeof SCHEDULE_IMAGE_RESOLUTIONS)[number];

const EXPORT_CANVAS_WIDTH = 1920;
const EXPORT_ROOT_HORIZONTAL_PADDING = 48;

interface ExportOperatorContext {
  planIndex: number;
  type: RoomKey;
  position: number;
  slotIndex: number;
}

export interface ScheduleImagePreparationOptions {
  source: HTMLElement;
  schedule: ScheduleDocument;
  normalizedSchedule: ScheduleDocument;
  resolveOperator: (name: string) => Operator | undefined;
  resolveEliteLevel: (
    name: string,
    context: ExportOperatorContext,
  ) => EliteLevel;
}

export interface ScheduleImageExportOptions extends ScheduleImagePreparationOptions {
  resolution: ScheduleImageResolution;
}

export interface PreparedScheduleImage {
  root: HTMLDivElement;
  cleanup: () => void;
}

interface ExportRootParts {
  root: HTMLDivElement;
  grid: HTMLElement;
}

interface FacilityColumnMeasurement {
  width: number;
  slotWidth: number;
  slotGridWidth: number;
}

function directChildrenWithClass(
  parent: Element,
  className: string,
): HTMLElement[] {
  return Array.from(parent.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains(className),
  );
}

function facilityQueueCards(parent: Element): HTMLElement[] {
  return Array.from(
    parent.querySelectorAll<HTMLElement>(".simulator-facility-queue"),
  ).filter((card) => {
    const owner = card.closest<HTMLElement>(
      ".simulator-facility-column, .simulator-export-dormitory-segment",
    );
    return owner === parent || parent.contains(card);
  });
}

function occupiedSlot(slot: HTMLElement): boolean {
  return Boolean(slot.querySelector(".operator-avatar-display"));
}

function createTextElement(
  tagName: "div" | "span",
  className: string,
  text: string,
): HTMLElement {
  const element = window.document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function prepareQueueColumn(
  grid: HTMLElement,
  schedule: ScheduleDocument,
): void {
  const queueColumn = directChildrenWithClass(
    grid,
    "simulator-queue-column",
  )[0];
  if (!queueColumn) {
    return;
  }

  queueColumn.classList.add("simulator-export-queue-column");
  const queueCard = directChildrenWithClass(
    queueColumn,
    "simulator-queue-card",
  )[0];
  if (!queueCard) {
    return;
  }

  queueCard.classList.add("simulator-export-queue-card");
  const queueHead = queueCard.querySelector<HTMLElement>(".ant-card-head");
  queueHead?.classList.add("simulator-export-queue-head-spacer");
  queueHead?.replaceChildren();
  const entries = queueCard.querySelector<HTMLElement>(
    ".simulator-queue-entries",
  );
  if (!entries) {
    return;
  }

  const queuePlans = schedule.plans;
  Array.from(entries.children).forEach((entry, planIndex) => {
    const plan = queuePlans[planIndex];
    if (!(entry instanceof HTMLElement) || !plan) {
      entry.remove();
      return;
    }
    entry.className = "simulator-export-queue-info";
    const queueInfo = [
      createTextElement(
        "div",
        "simulator-export-queue-name",
        plan.name?.trim() || `未命名队列${planIndex + 1}`,
      ),
      createTextElement(
        "div",
        "simulator-export-queue-duration",
        formatDurationHours(planDurationHoursValue(plan)),
      ),
    ];
    if (plan.description?.trim()) {
      queueInfo.push(
        createTextElement(
          "div",
          "simulator-export-queue-description",
          plan.description.trim(),
        ),
      );
    }
    entry.replaceChildren(...queueInfo);
  });
}

function createExportRoot(
  source: HTMLElement,
  schedule: ScheduleDocument,
): ExportRootParts {
  const root = window.document.createElement("div");
  root.className = "simulator-image-export-root";

  const heading = window.document.createElement("div");
  heading.className = "simulator-image-export-heading";
  heading.append(
    createTextElement(
      "div",
      "simulator-image-export-title",
      schedule.title?.trim() || "未命名排班表",
    ),
  );
  if (schedule.description?.trim()) {
    heading.append(
      createTextElement(
        "div",
        "simulator-image-export-description",
        schedule.description.trim(),
      ),
    );
  }
  const editor = source.closest<HTMLElement>(".simulator-editor");
  const dailyOutput = editor?.querySelector<HTMLElement>(
    ".simulator-daily-output",
  );
  if (dailyOutput) {
    const dailyOutputClone = dailyOutput.cloneNode(true) as HTMLElement;
    dailyOutputClone.classList.add("simulator-image-export-daily-output");
    heading.append(dailyOutputClone);
  }

  root.append(heading);

  const grid = source.cloneNode(true) as HTMLElement;
  root.append(grid);
  return { root, grid };
}

function removeExportControls(root: HTMLElement): void {
  root
    .querySelectorAll(
      "button, input, textarea, select, .simulator-edit-settings, .simulator-toolbar, .simulator-efficiency-settings-entry, .simulator-operator-picker, .simulator-context-menu, .ant-card-extra",
    )
    .forEach((element) => element.remove());
  root.querySelectorAll<HTMLElement>(".simulator-slot").forEach((slot) => {
    slot.classList.remove(
      "simulator-slot--selected",
      "simulator-slot--hovered",
      "simulator-slot--clipboard",
      "simulator-slot--paste-highlight",
    );
  });
}

function distributeTargets(
  targets: string[],
  queueCount: number,
  queueIndex: number,
): string[] {
  if (queueCount <= 0) {
    return [];
  }
  const baseCount = Math.floor(targets.length / queueCount);
  const remainder = targets.length % queueCount;
  const start = queueIndex * baseCount + Math.min(queueIndex, remainder);
  const count = baseCount + (queueIndex < remainder ? 1 : 0);
  return targets.slice(start, start + count);
}

function prepareFiammettaColumn(
  grid: HTMLElement,
  schedule: ScheduleDocument,
): void {
  if (schedule.settings?.fiammettaMode !== "direct") {
    return;
  }
  const column = directChildrenWithClass(
    grid,
    "simulator-facility-column",
  ).find((candidate) => candidate.dataset.facilityKey === "fiammetta");
  if (!column) {
    return;
  }

  const targets =
    schedule.fiammetta?.direct?.operators?.filter((name): name is string =>
      Boolean(name),
    ) ?? [];
  const queues = facilityQueueCards(column);
  const firstGrid = queues[0]?.querySelector<HTMLElement>(
    ".simulator-slot-grid",
  );
  const templates = firstGrid
    ? Array.from(firstGrid.children).filter(
        (slot): slot is HTMLElement =>
          slot instanceof HTMLElement && occupiedSlot(slot),
      )
    : [];

  queues.forEach((queue, planIndex) => {
    const slotGrid = queue.querySelector<HTMLElement>(".simulator-slot-grid");
    if (!slotGrid) {
      return;
    }
    const queueTargets = distributeTargets(
      targets,
      schedule.plans.length,
      planIndex,
    );
    const baseCount = Math.floor(targets.length / schedule.plans.length);
    const remainder = targets.length % schedule.plans.length;
    const targetStart = planIndex * baseCount + Math.min(planIndex, remainder);
    const slots = queueTargets.flatMap((target, slotIndex) => {
      const template = templates[targetStart + slotIndex];
      if (!template) {
        return [];
      }
      const slot = template.cloneNode(true) as HTMLElement;
      slot.dataset.exportPlanIndex = String(planIndex);
      slot.dataset.exportSlotIndex = String(slotIndex);
      slot.dataset.exportOriginalName = target;
      return [slot];
    });
    slotGrid.replaceChildren(...slots);
    queue.style.removeProperty("display");
  });
}

function roomOperators(
  schedule: ScheduleDocument,
  context: ExportOperatorContext,
): string[] {
  if (context.position < 0) {
    return [];
  }
  const plan = schedule.plans[context.planIndex];
  const rooms = plan?.rooms[context.type];
  const room = Array.isArray(rooms) ? rooms[context.position] : undefined;
  const operators =
    room && typeof room === "object" && !Array.isArray(room)
      ? (room as { operators?: unknown }).operators
      : undefined;
  return Array.isArray(operators)
    ? operators.filter(
        (name): name is string => typeof name === "string" && name.length > 0,
      )
    : [];
}

function normalizedOperatorName(
  options: ScheduleImagePreparationOptions,
  sourceName: string,
  context: ExportOperatorContext,
): string {
  const sourceOperators = roomOperators(options.schedule, context);
  const sourceSlotIndex =
    sourceOperators.slice(0, context.slotIndex + 1).filter(Boolean).length - 1;
  const normalizedOperators = roomOperators(options.normalizedSchedule, {
    ...context,
    slotIndex: Math.max(0, sourceSlotIndex),
  });
  if (sourceSlotIndex < 0 || sourceOperators[sourceSlotIndex] !== sourceName) {
    return sourceName;
  }
  return normalizedOperators[sourceSlotIndex] ?? sourceName;
}

function createAvatarImage(
  className: string,
  source: string,
  alt: string,
): HTMLImageElement {
  const image = window.document.createElement("img");
  image.className = className;
  image.src = source;
  image.alt = alt;
  image.decoding = "async";
  image.crossOrigin = "anonymous";
  return image;
}

function replaceMappedSpecialAvatar(
  slot: HTMLElement,
  mappedName: string,
  context: ExportOperatorContext,
  options: ScheduleImagePreparationOptions,
): void {
  const display = slot.querySelector<HTMLElement>(".operator-avatar-display");
  const frame = display?.querySelector<HTMLElement>(".operator-avatar-frame");
  const specialLabel = display?.querySelector<HTMLElement>(
    ".operator-avatar-special-label",
  );
  if (!display || !frame || !specialLabel) {
    return;
  }
  const operator = options.resolveOperator(mappedName);
  if (!operator) {
    throw new Error(`特殊干员映射失败：找不到“${mappedName}”`);
  }

  const sources = getOperatorAvatarLayerSources(
    operator,
    options.resolveEliteLevel(mappedName, context),
  );
  frame.classList.remove("operator-avatar-frame--special");
  frame.classList.add("operator-avatar-frame--plain");
  frame.replaceChildren();
  if (sources.avatarUrl) {
    frame.append(
      createAvatarImage(
        "operator-avatar-base",
        sources.avatarUrl,
        `${mappedName}头像`,
      ),
    );
  } else {
    throw new Error(`特殊干员映射失败：找不到“${mappedName}”头像`);
  }
  if (sources.professionIconUrl) {
    frame.append(
      createAvatarImage(
        "operator-avatar-badge operator-avatar-badge--profession",
        sources.professionIconUrl,
        `${operator.profession}职业`,
      ),
    );
  }
  if (sources.eliteIconUrl) {
    frame.append(
      createAvatarImage(
        "operator-avatar-badge operator-avatar-badge--elite",
        sources.eliteIconUrl,
        `精英${options.resolveEliteLevel(mappedName, context)}`,
      ),
    );
  }
  if (sources.rarityIconUrl) {
    frame.append(
      createAvatarImage(
        "operator-avatar-badge operator-avatar-badge--rarity",
        sources.rarityIconUrl,
        `${operator.rarity}星`,
      ),
    );
  }
  const name = display.querySelector<HTMLElement>(
    ".operator-avatar-display-name",
  );
  if (name) {
    name.textContent = mappedName;
  }
  const nameMeasure = display.querySelector<HTMLElement>(
    ".operator-avatar-name-measure",
  );
  if (nameMeasure) {
    nameMeasure.textContent = mappedName;
  }
}

function replaceMappedSpecialOperators(
  grid: HTMLElement,
  options: ScheduleImagePreparationOptions,
): void {
  grid.querySelectorAll<HTMLElement>(".simulator-slot").forEach((slot) => {
    const sourceName = slot.dataset.exportOriginalName?.trim() ?? "";
    if (!sourceName || !slot.querySelector(".operator-avatar-frame--special")) {
      return;
    }
    const context: ExportOperatorContext = {
      planIndex: Number(slot.dataset.exportPlanIndex ?? -1),
      type: (slot.dataset.exportRoomType ?? "") as RoomKey,
      position: Number(slot.dataset.exportPosition ?? -1),
      slotIndex: Number(slot.dataset.exportSlotIndex ?? -1),
    };
    const mappedName = normalizedOperatorName(options, sourceName, context);
    if (mappedName !== sourceName) {
      replaceMappedSpecialAvatar(slot, mappedName, context, options);
    }
  });
}

function mergeDormitories(grid: HTMLElement): void {
  const columns = directChildrenWithClass(
    grid,
    "simulator-facility-column",
  ).filter(
    (column) =>
      column.dataset.facilityType === "dormitory" &&
      column.dataset.fiammetta !== "true",
  );
  if (columns.length <= 1) {
    return;
  }

  const first = columns[0]!;
  const card = directChildrenWithClass(first, "simulator-facility-card")[0];
  const body = card?.querySelector<HTMLElement>(":scope > .ant-card-body");
  const firstQueues = body?.querySelector<HTMLElement>(
    ".simulator-facility-queues",
  );
  if (!card || !body || !firstQueues) {
    return;
  }

  const merged = window.document.createElement("div");
  merged.className = "simulator-export-dormitory-grid";
  columns.forEach((column, index) => {
    const columnCard = directChildrenWithClass(
      column,
      "simulator-facility-card",
    )[0];
    const queues = columnCard?.querySelector<HTMLElement>(
      ".simulator-facility-queues",
    );
    if (!queues) {
      return;
    }
    const segment = window.document.createElement("div");
    segment.className = "simulator-export-dormitory-segment";
    segment.dataset.exportDormitorySegment = "true";
    const width = Math.max(1, Math.round(column.getBoundingClientRect().width));
    segment.style.flexBasis = `${width}px`;
    segment.style.width = `${width}px`;
    if (index > 0) {
      segment.classList.add("simulator-export-dormitory-segment--separated");
    }
    queues.classList.add("simulator-export-dormitory-queues");
    segment.append(queues);
    merged.append(segment);
  });

  const title = card.querySelector<HTMLElement>(
    ".simulator-facility-title > span:first-child",
  );
  if (title) {
    title.textContent = "宿舍";
  }
  body.replaceChildren(merged);
  columns.slice(1).forEach((column) => column.remove());
}

function facilityColumnMeasurement(
  group: HTMLElement,
): FacilityColumnMeasurement {
  const slots = Array.from(
    group.querySelectorAll<HTMLElement>(".simulator-slot"),
  );
  const slotWidth = slots[0]?.getBoundingClientRect().width ?? 90;
  const width = Math.max(1, group.getBoundingClientRect().width);
  const slotGridWidth = Math.max(
    0,
    ...Array.from(group.querySelectorAll<HTMLElement>(".simulator-slot-grid"))
      .map((slotGrid) => slotGrid.getBoundingClientRect().width)
      .filter((gridWidth) => gridWidth > 0),
  );
  return { width, slotWidth, slotGridWidth };
}

function pruneSlotGroup(group: HTMLElement): number {
  const queues = facilityQueueCards(group);
  const measurement = facilityColumnMeasurement(group);
  const grids = queues
    .map((queue) => queue.querySelector<HTMLElement>(".simulator-slot-grid"))
    .filter((candidate): candidate is HTMLElement => Boolean(candidate));
  const slotGroups = grids.map((slotGrid) =>
    Array.from(slotGrid.children).filter(
      (slot): slot is HTMLElement => slot instanceof HTMLElement,
    ),
  );
  const originalSlotCount = Math.max(
    0,
    ...slotGroups.map((slots) => slots.length),
  );
  const visibleIndexes = Array.from(
    { length: originalSlotCount },
    (_, index) =>
      slotGroups.some((slots) => {
        const slot = slots[index];
        return slot ? occupiedSlot(slot) : false;
      })
        ? index
        : -1,
  ).filter((index) => index >= 0);
  const visibleIndexSet = new Set(visibleIndexes);
  slotGroups.forEach((slots) => {
    slots.forEach((slot, index) => {
      if (!visibleIndexSet.has(index)) {
        slot.remove();
        return;
      }
      if (!occupiedSlot(slot)) {
        slot.replaceChildren();
        slot.className = "simulator-slot simulator-export-empty-slot";
      }
    });
  });
  const visibleCount = visibleIndexes.length;
  if (visibleCount === 0) {
    return 0;
  }

  const originalGridWidth = Math.max(
    measurement.slotGridWidth,
    originalSlotCount * measurement.slotWidth,
  );
  const overhead = Math.max(0, measurement.width - originalGridWidth);
  const width = overhead + visibleCount * measurement.slotWidth;
  if (group.classList.contains("simulator-export-dormitory-segment")) {
    const segmentWidth = `${Math.max(1, Math.round(width))}px`;
    group.style.flexBasis = segmentWidth;
    group.style.width = segmentWidth;
  } else {
    const column = group.closest<HTMLElement>(".simulator-facility-column");
    column?.style.setProperty(
      "--simulator-column-width",
      `${Math.max(1, Math.round(width))}px`,
    );
    column?.style.setProperty("width", `${Math.max(1, Math.round(width))}px`);
  }
  return visibleCount;
}

function pruneEmptyFacilities(grid: HTMLElement): void {
  directChildrenWithClass(grid, "simulator-facility-column").forEach(
    (column) => {
      const merged = column.querySelector<HTMLElement>(
        ".simulator-export-dormitory-grid",
      );
      const segments = merged
        ? directChildrenWithClass(merged, "simulator-export-dormitory-segment")
        : [];
      if (segments.length > 0) {
        segments.forEach((segment) => {
          if (pruneSlotGroup(segment) === 0) {
            segment.remove();
          }
        });
        if (merged) {
          const remaining = directChildrenWithClass(
            merged,
            "simulator-export-dormitory-segment",
          );
          if (remaining.length === 0) {
            column.remove();
            return;
          }
          const gap = Number.parseFloat(getComputedStyle(merged).gap) || 0;
          const width = remaining.reduce(
            (total, segment) => total + segment.getBoundingClientRect().width,
            0,
          );
          column.style.setProperty(
            "--simulator-column-width",
            `${Math.round(width + gap * Math.max(0, remaining.length - 1))}px`,
          );
        }
        return;
      }
      if (pruneSlotGroup(column) === 0) {
        column.remove();
      }
    },
  );
}

function facilityColumnWidth(column: HTMLElement): number {
  return Math.max(1, Math.round(column.getBoundingClientRect().width));
}

function rowWidth(
  widths: number[],
  start: number,
  end: number,
  gap: number,
): number {
  return (
    widths.slice(start, end).reduce((total, width) => total + width, 0) +
    Math.max(0, end - start - 1) * gap
  );
}

function partitionFacilities(
  columns: HTMLElement[],
  maxWidth: number,
  gap: number,
): HTMLElement[][] {
  if (columns.length === 0) {
    return [];
  }
  const widths = columns.map(facilityColumnWidth);
  const totalWidth = rowWidth(widths, 0, widths.length, gap);
  let rowCount = 1;
  let currentWidth = 0;
  widths.forEach((width) => {
    const nextWidth = currentWidth === 0 ? width : currentWidth + gap + width;
    if (currentWidth > 0 && nextWidth > maxWidth) {
      rowCount += 1;
      currentWidth = width;
      return;
    }
    currentWidth = nextWidth;
  });
  if (rowCount === 1) {
    return [columns];
  }

  const targetWidth = totalWidth / rowCount;
  const costs = Array.from({ length: rowCount + 1 }, () =>
    Array<number>(columns.length + 1).fill(Number.POSITIVE_INFINITY),
  );
  const previous = Array.from({ length: rowCount + 1 }, () =>
    Array<number>(columns.length + 1).fill(-1),
  );
  costs[0]![0] = 0;
  for (let rows = 1; rows <= rowCount; rows += 1) {
    for (let end = rows; end <= columns.length; end += 1) {
      for (let start = rows - 1; start < end; start += 1) {
        const previousCost =
          costs[rows - 1]![start] ?? Number.POSITIVE_INFINITY;
        if (!Number.isFinite(previousCost)) {
          continue;
        }
        const width = rowWidth(widths, start, end, gap);
        if (width > maxWidth && end - start > 1) {
          continue;
        }
        const cost = previousCost + (width - targetWidth) ** 2;
        if (cost < costs[rows]![end]!) {
          costs[rows]![end] = cost;
          previous[rows]![end] = start;
        }
      }
    }
  }
  if (!Number.isFinite(costs[rowCount]![columns.length])) {
    return [columns];
  }

  const groups: HTMLElement[][] = [];
  let end = columns.length;
  for (let rows = rowCount; rows > 0; rows -= 1) {
    const start = previous[rows]![end] ?? -1;
    const resolvedStart = start >= 0 ? start : rows - 1;
    groups.unshift(columns.slice(resolvedStart, end));
    end = resolvedStart;
  }
  return groups;
}

function reflowFacilities(grid: HTMLElement): void {
  const queueColumns = directChildrenWithClass(grid, "simulator-queue-column");
  const columns = [
    ...queueColumns,
    ...directChildrenWithClass(grid, "simulator-facility-column"),
  ];
  const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 10;
  const availableWidth = Math.max(
    1,
    EXPORT_CANVAS_WIDTH - EXPORT_ROOT_HORIZONTAL_PADDING,
  );
  const groups = partitionFacilities(columns, availableWidth, gap);
  const rows: HTMLElement[] = [];
  groups.forEach((group) => {
    const row = window.document.createElement("div");
    row.className = "simulator-export-facility-row";
    row.style.gap = `${gap}px`;
    row.style.width = `${availableWidth}px`;
    row.style.minWidth = "0";
    row.style.justifyContent = "flex-start";
    group.forEach((column) => row.append(column));
    rows.push(row);
  });

  grid.classList.add("simulator-export-facility-grid");
  grid.style.display = "grid";
  grid.style.rowGap = `${gap}px`;
  grid.style.marginInline = "0";
  grid.style.paddingInline = "0";
  grid.style.width = `${availableWidth}px`;
  grid.style.minWidth = `${availableWidth}px`;
  grid.style.overflow = "visible";
  grid.replaceChildren(...rows);
}

function waitForImages(root: HTMLElement): Promise<void> {
  return Promise.all(
    Array.from(root.querySelectorAll("img")).map((image) => {
      if (image.complete) {
        return image.naturalWidth > 0
          ? Promise.resolve()
          : Promise.reject(
              new Error(
                `图片加载失败：${image.alt || image.getAttribute("src") || "未知图片"}`,
              ),
            );
      }
      return new Promise<void>((resolve, reject) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener(
          "error",
          () =>
            reject(
              new Error(
                `图片加载失败：${image.alt || image.getAttribute("src") || "未知图片"}`,
              ),
            ),
          { once: true },
        );
      });
    }),
  ).then(() => undefined);
}

function svgToPng(
  svgUrl: string,
  resolution: ScheduleImageResolution,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = window.document.createElement("canvas");
      canvas.width = resolution.width;
      canvas.height = resolution.height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("当前浏览器不支持图片画布"));
        return;
      }
      context.fillStyle = "#f4f6f7";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(
        canvas.width / image.naturalWidth,
        canvas.height / image.naturalHeight,
      );
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(
        image,
        (canvas.width - width) / 2,
        (canvas.height - height) / 2,
        width,
        height,
      );
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("排班表图片渲染失败"));
    image.src = svgUrl;
  });
}

export async function prepareScheduleImage(
  options: ScheduleImagePreparationOptions,
): Promise<PreparedScheduleImage> {
  const host = window.document.createElement("div");
  host.className = "simulator-image-export-host";
  host.style.width = `${EXPORT_CANVAS_WIDTH}px`;
  const parts = createExportRoot(options.source, options.schedule);
  host.append(parts.root);
  window.document.body.append(host);

  try {
    prepareQueueColumn(parts.grid, options.schedule);
    prepareFiammettaColumn(parts.grid, options.schedule);
    replaceMappedSpecialOperators(parts.grid, options);
    mergeDormitories(parts.grid);
    pruneEmptyFacilities(parts.grid);
    removeExportControls(parts.root);
    reflowFacilities(parts.grid);
    await waitForImages(parts.root);
    return {
      root: parts.root,
      cleanup: () => {
        parts.root.remove();
        host.remove();
      },
    };
  } catch (error: unknown) {
    host.remove();
    throw error;
  }
}

export async function renderPreparedScheduleImage(
  root: HTMLElement,
  resolution: ScheduleImageResolution,
): Promise<string> {
  await waitForImages(root);
  const svgUrl = await toSvg(root, {
    backgroundColor: "#f4f6f7",
    cacheBust: true,
    skipFonts: true,
    style: {
      inset: "auto",
      position: "static",
    },
  });
  return await svgToPng(svgUrl, resolution);
}

export async function renderScheduleImage(
  options: ScheduleImageExportOptions,
): Promise<string> {
  const prepared = await prepareScheduleImage(options);
  try {
    return await renderPreparedScheduleImage(prepared.root, options.resolution);
  } finally {
    prepared.cleanup();
  }
}
