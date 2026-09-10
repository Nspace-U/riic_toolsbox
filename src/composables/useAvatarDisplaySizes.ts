import { ref } from "vue";

export type AvatarDisplaySizeTarget =
  "progressionCard" | "simulatorSlot" | "skillCard";

export interface AvatarDisplaySizeOption {
  label: string;
  defaultSize: number;
  minSize: number;
  maxSize: number;
}

export type AvatarDisplaySizes = Record<AvatarDisplaySizeTarget, number>;

export const AVATAR_DISPLAY_SIZE_TARGETS: AvatarDisplaySizeTarget[] = [
  "progressionCard",
  "simulatorSlot",
  "skillCard",
];

export const AVATAR_DISPLAY_SIZE_OPTIONS: Record<
  AvatarDisplaySizeTarget,
  AvatarDisplaySizeOption
> = {
  progressionCard: {
    label: "设置页练度卡片",
    defaultSize: 56,
    minSize: 40,
    maxSize: 96,
  },
  simulatorSlot: {
    label: "排班模拟器设施槽位",
    defaultSize: 72,
    minSize: 48,
    maxSize: 120,
  },
  skillCard: {
    label: "基建技能一览与技能生成器卡片",
    defaultSize: 112,
    minSize: 72,
    maxSize: 144,
  },
};

const AVATAR_DISPLAY_SIZES_STORAGE_KEY = "riic-tools:avatar-display-sizes:v1";

function createDefaultAvatarDisplaySizes(): AvatarDisplaySizes {
  return {
    progressionCard: AVATAR_DISPLAY_SIZE_OPTIONS.progressionCard.defaultSize,
    simulatorSlot: AVATAR_DISPLAY_SIZE_OPTIONS.simulatorSlot.defaultSize,
    skillCard: AVATAR_DISPLAY_SIZE_OPTIONS.skillCard.defaultSize,
  };
}

function normalizeAvatarDisplaySize(
  target: AvatarDisplaySizeTarget,
  value: unknown,
): number {
  const option = AVATAR_DISPLAY_SIZE_OPTIONS[target];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return option.defaultSize;
  }
  return Math.min(Math.max(Math.round(value), option.minSize), option.maxSize);
}

function readStoredAvatarDisplaySizes(): AvatarDisplaySizes {
  const defaults = createDefaultAvatarDisplaySizes();
  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const storedValue = window.localStorage.getItem(
      AVATAR_DISPLAY_SIZES_STORAGE_KEY,
    );
    if (!storedValue) {
      return defaults;
    }
    const parsedValue: unknown = JSON.parse(storedValue);
    if (typeof parsedValue !== "object" || parsedValue === null) {
      return defaults;
    }
    const storedSizes = parsedValue as Record<string, unknown>;
    return {
      progressionCard: normalizeAvatarDisplaySize(
        "progressionCard",
        storedSizes.progressionCard,
      ),
      simulatorSlot: normalizeAvatarDisplaySize(
        "simulatorSlot",
        storedSizes.simulatorSlot,
      ),
      skillCard: normalizeAvatarDisplaySize("skillCard", storedSizes.skillCard),
    };
  } catch {
    return defaults;
  }
}

const avatarDisplaySizes = ref<AvatarDisplaySizes>(
  readStoredAvatarDisplaySizes(),
);

function persistAvatarDisplaySizes(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      AVATAR_DISPLAY_SIZES_STORAGE_KEY,
      JSON.stringify(avatarDisplaySizes.value),
    );
  } catch {}
}

function setAvatarDisplaySize(
  target: AvatarDisplaySizeTarget,
  value: number,
): void {
  avatarDisplaySizes.value = {
    ...avatarDisplaySizes.value,
    [target]: normalizeAvatarDisplaySize(target, value),
  };
  persistAvatarDisplaySizes();
}

function resetAvatarDisplaySizes(): void {
  avatarDisplaySizes.value = createDefaultAvatarDisplaySizes();
  persistAvatarDisplaySizes();
}

export function useAvatarDisplaySizes() {
  return {
    avatarDisplaySizes,
    avatarDisplaySizeOptions: AVATAR_DISPLAY_SIZE_OPTIONS,
    avatarDisplaySizeTargets: AVATAR_DISPLAY_SIZE_TARGETS,
    setAvatarDisplaySize,
    resetAvatarDisplaySizes,
  };
}
