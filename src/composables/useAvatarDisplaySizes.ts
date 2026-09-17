import { ref } from "vue";

export type AvatarDisplaySizeTarget = "simulatorSlot";

export interface AvatarDisplaySizeOption {
  label: string;
  defaultSize: number;
  minSize: number;
  maxSize: number;
}

export type AvatarDisplaySizes = Record<AvatarDisplaySizeTarget, number>;

export const AVATAR_DISPLAY_SIZE_TARGETS: AvatarDisplaySizeTarget[] = [
  "simulatorSlot",
];

export const AVATAR_DISPLAY_SIZE_OPTIONS: Record<
  AvatarDisplaySizeTarget,
  AvatarDisplaySizeOption
> = {
  simulatorSlot: {
    label: "排班模拟器设施槽位",
    defaultSize: 90,
    minSize: 48,
    maxSize: 120,
  },
};

const AVATAR_DISPLAY_SIZES_STORAGE_KEY = "riic-tools:avatar-display-sizes:v1";

function createDefaultAvatarDisplaySizes(): AvatarDisplaySizes {
  return {
    simulatorSlot: AVATAR_DISPLAY_SIZE_OPTIONS.simulatorSlot.defaultSize,
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
      simulatorSlot: normalizeAvatarDisplaySize(
        "simulatorSlot",
        storedSizes.simulatorSlot,
      ),
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

function setAvatarDisplaySize(value: number): void {
  avatarDisplaySizes.value = {
    ...avatarDisplaySizes.value,
    simulatorSlot: normalizeAvatarDisplaySize("simulatorSlot", value),
  };
  persistAvatarDisplaySizes();
}

function resetAvatarDisplaySize(): void {
  avatarDisplaySizes.value = {
    ...avatarDisplaySizes.value,
    simulatorSlot: AVATAR_DISPLAY_SIZE_OPTIONS.simulatorSlot.defaultSize,
  };
  persistAvatarDisplaySizes();
}

export function useAvatarDisplaySizes() {
  return {
    avatarDisplaySizes,
    avatarDisplaySizeOptions: AVATAR_DISPLAY_SIZE_OPTIONS,
    avatarDisplaySizeTargets: AVATAR_DISPLAY_SIZE_TARGETS,
    setAvatarDisplaySize,
    resetAvatarDisplaySize,
  };
}
