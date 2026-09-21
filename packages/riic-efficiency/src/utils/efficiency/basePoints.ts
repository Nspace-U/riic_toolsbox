import type { BaseSkillTerms } from "../../types/baseData";
import type {
  BasePointDetail,
  BasePointSource,
  EfficiencyTerm,
} from "../../types/efficiency";
import { ROOM_ORDER } from "../schedule";

export interface BasePointTermOption {
  key: string;
  name: string;
}

export const BASE_POINT_TERM_KEYS = [
  "cc.t.flow_gold",
  "cc.bd_a1",
  "cc.bd_malist",
  "cc.bd_a1_a1",
  "cc.bd_a1_a2",
  "cc.bd_dungeon",
  "cc.bd_felyne",
  "cc.bd_ash",
  "cc.bd_mujica",
  "cc.bd_b1",
  "cc.bd_wang_2",
  "cc.bd_A",
  "cc.bd_wang_1",
  "cc.bd_tachanka",
  "cc.bd_C",
  "cc.bd_B",
  "cc.bd_a1_a3",
] as const;

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, "zh-CN") || left.localeCompare(right);
}

export function compareBasePointTermOptions(
  left: BasePointTermOption,
  right: BasePointTermOption,
): number {
  return (
    compareNames(left.name, right.name) || left.key.localeCompare(right.key)
  );
}

export function basePointTermOptions(
  terms: BaseSkillTerms | Record<string, EfficiencyTerm>,
): BasePointTermOption[] {
  return BASE_POINT_TERM_KEYS.map((key) => ({
    key,
    name: terms[key]?.name ?? key,
  })).sort(compareBasePointTermOptions);
}

export function compareBasePointDetails(
  left: BasePointDetail,
  right: BasePointDetail,
  terms: Record<string, EfficiencyTerm>,
): number {
  return (
    right.value - left.value ||
    compareBasePointTermOptions(
      { key: left.term, name: terms[left.term]?.name ?? left.term },
      { key: right.term, name: terms[right.term]?.name ?? right.term },
    )
  );
}

export function compareBasePointSources(
  left: BasePointSource,
  right: BasePointSource,
): number {
  return (
    right.value - left.value ||
    (left.kind === right.kind ? 0 : left.kind === "gain" ? -1 : 1) ||
    ROOM_ORDER.indexOf(left.facility) - ROOM_ORDER.indexOf(right.facility) ||
    left.facilityIndex - right.facilityIndex ||
    left.slotIndex - right.slotIndex
  );
}
