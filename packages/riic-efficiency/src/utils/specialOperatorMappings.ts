import percentageOperatorMappings from "../data/percentage-operator-mappings.json";
import type { EfficiencyCatalog } from "../types/efficiency";
import type {
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
} from "../types/schedule";
import { ROOM_LABELS, cloneSchedule } from "./schedule";
import {
  isPercentageOperator,
  isTermOperator,
  specialOperatorTermMembers,
} from "./specialOperators";

export interface PercentageOperatorMapping {
  room: RoomKey;
  product?: string;
  percentage: string;
  operators: string[];
}

export interface SpecialOperatorMappingIssue {
  planIndex: number;
  room: RoomKey;
  roomIndex: number;
  slotIndex: number;
  name: string;
  errorMessage: string;
}

const PERCENTAGE_OPERATOR_MAPPINGS =
  percentageOperatorMappings as PercentageOperatorMapping[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function percentageMappingFor(
  room: RoomKey,
  product: string | undefined,
  percentage: string,
): PercentageOperatorMapping | undefined {
  return PERCENTAGE_OPERATOR_MAPPINGS.find(
    (mapping) =>
      mapping.room === room &&
      mapping.percentage === percentage &&
      (mapping.product === undefined || mapping.product === product),
  );
}

export function mapSpecialOperators(
  document: ScheduleDocument,
  catalog?: EfficiencyCatalog,
): { document: ScheduleDocument; issues: SpecialOperatorMappingIssue[] } {
  const mappedDocument = cloneSchedule(document);
  const percentagePositions = new Map<string, number>();
  const issues: SpecialOperatorMappingIssue[] = [];

  mappedDocument.plans.forEach((plan, planIndex) => {
    const used = new Set<string>();
    Object.values(plan.rooms).forEach((value) => {
      if (!Array.isArray(value)) {
        return;
      }
      value.forEach((roomValue) => {
        if (!isRecord(roomValue) || !Array.isArray(roomValue.operators)) {
          return;
        }
        roomValue.operators.forEach((name) => {
          if (
            typeof name === "string" &&
            !isPercentageOperator(name) &&
            !(catalog && isTermOperator(name, catalog))
          ) {
            used.add(name);
          }
        });
      });
    });

    Object.entries(plan.rooms).forEach(([type, value]) => {
      if (!Array.isArray(value)) {
        return;
      }
      value.forEach((roomValue, roomIndex) => {
        if (!isRecord(roomValue) || !Array.isArray(roomValue.operators)) {
          return;
        }

        const room = roomValue as RoomAssignment;
        const roomType = type as RoomKey;
        const operators = room.operators ?? [];
        const states = room.operatorStates;
        const mappedStates: NonNullable<RoomAssignment["operatorStates"]> = {};
        room.operators = operators.map((name, slotIndex) => {
          const mapping = percentageMappingFor(roomType, room.product, name);
          if (mapping) {
            const key = `${roomType}|${mapping.product ?? "*"}|${mapping.percentage}`;
            const position = percentagePositions.get(key) ?? 0;
            let next = -1;
            for (
              let offset = 0;
              offset < mapping.operators.length;
              offset += 1
            ) {
              const index = (position + offset) % mapping.operators.length;
              if (!used.has(mapping.operators[index]!)) {
                next = index;
                break;
              }
            }
            if (next < 0) {
              issues.push({
                planIndex,
                room: roomType,
                roomIndex,
                slotIndex,
                name,
                errorMessage: `${ROOM_LABELS[roomType]} 中的 ${name} 没有可用的百分比映射干员`,
              });
              if (states?.[name]) mappedStates[name] = states[name];
              return name;
            }

            const mapped = mapping.operators[next]!;
            percentagePositions.set(key, (next + 1) % mapping.operators.length);
            used.add(mapped);
            if (states?.[name]) mappedStates[mapped] = states[name];
            return mapped;
          }

          if (isPercentageOperator(name)) {
            issues.push({
              planIndex,
              room: roomType,
              roomIndex,
              slotIndex,
              name,
              errorMessage: `${ROOM_LABELS[roomType]} 中的百分比干员“${name}”没有配置映射`,
            });
            if (states?.[name]) mappedStates[name] = states[name];
            return name;
          }

          if (catalog && isTermOperator(name, catalog)) {
            const mapped = specialOperatorTermMembers(name, catalog).find(
              (candidate) => !used.has(candidate),
            );
            if (!mapped) {
              issues.push({
                planIndex,
                room: roomType,
                roomIndex,
                slotIndex,
                name,
                errorMessage: `${ROOM_LABELS[roomType]} 中的术语干员“${name}”没有可用的映射干员`,
              });
              if (states?.[name]) mappedStates[name] = states[name];
              return name;
            }

            used.add(mapped);
            if (states?.[name]) mappedStates[mapped] = states[name];
            return mapped;
          }

          if (states?.[name]) mappedStates[name] = states[name];
          return name;
        });

        if (Object.keys(mappedStates).length > 0) {
          room.operatorStates = mappedStates;
        } else {
          delete room.operatorStates;
        }
      });
    });
  });

  return { document: mappedDocument, issues };
}
