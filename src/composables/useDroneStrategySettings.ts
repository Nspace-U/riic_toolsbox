import { ref } from "vue";

import {
  DEFAULT_LMD_DRONE_STRATEGIES,
  type LmdDroneStrategies,
  type LmdDroneStrategyLevel,
} from "@arknights/riic-efficiency";

export const DRONE_STRATEGY_SETTINGS_STORAGE_KEY =
  "riic-tools:drone-strategy-settings:v1";

const lmdDroneStrategies = ref<LmdDroneStrategies>(readLmdDroneStrategies());

function readLmdDroneStrategies(): LmdDroneStrategies {
  if (typeof window === "undefined") {
    return { ...DEFAULT_LMD_DRONE_STRATEGIES };
  }

  try {
    const raw = window.localStorage.getItem(
      DRONE_STRATEGY_SETTINGS_STORAGE_KEY,
    );
    if (!raw) {
      return { ...DEFAULT_LMD_DRONE_STRATEGIES };
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ...DEFAULT_LMD_DRONE_STRATEGIES };
    }
    const candidate = parsed as Partial<LmdDroneStrategies>;
    return {
      1:
        typeof candidate[1] === "string"
          ? candidate[1]
          : DEFAULT_LMD_DRONE_STRATEGIES[1],
      2:
        typeof candidate[2] === "string"
          ? candidate[2]
          : DEFAULT_LMD_DRONE_STRATEGIES[2],
      3:
        typeof candidate[3] === "string"
          ? candidate[3]
          : DEFAULT_LMD_DRONE_STRATEGIES[3],
    };
  } catch {
    return { ...DEFAULT_LMD_DRONE_STRATEGIES };
  }
}

function persistLmdDroneStrategies(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      DRONE_STRATEGY_SETTINGS_STORAGE_KEY,
      JSON.stringify(lmdDroneStrategies.value),
    );
  } catch {}
}

function setLmdDroneStrategy(
  level: LmdDroneStrategyLevel,
  value: string,
): void {
  lmdDroneStrategies.value = { ...lmdDroneStrategies.value, [level]: value };
  persistLmdDroneStrategies();
}

function resetLmdDroneStrategy(level: LmdDroneStrategyLevel): void {
  lmdDroneStrategies.value = {
    ...lmdDroneStrategies.value,
    [level]: DEFAULT_LMD_DRONE_STRATEGIES[level],
  };
  persistLmdDroneStrategies();
}

export function useDroneStrategySettings() {
  return {
    lmdDroneStrategies,
    setLmdDroneStrategy,
    resetLmdDroneStrategy,
  };
}
