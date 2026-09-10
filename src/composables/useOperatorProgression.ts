import { computed, ref } from "vue";

import type {
  OperatorProgressionEntry,
  OperatorProgressionProfile,
} from "@/types/operatorProgression";
import {
  cloneProgressionEntries,
  parseOperatorProgressionImport,
} from "@/utils/operatorProgression";

const STORAGE_KEY = "riic-tools:operator-progression:v1";
const SETTINGS_STORAGE_KEY = "riic-tools:operator-progression-settings:v1";

interface StoredProgressionState {
  profiles: OperatorProgressionProfile[];
  activeProfileId: string;
}

interface StoredProgressionSettings {
  treatSkillsAsUnlocked: boolean;
  showNoEditableOperators: boolean;
  showUnownedOperators: boolean;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function cloneProfile(
  profile: OperatorProgressionProfile,
): OperatorProgressionProfile {
  return {
    ...profile,
    entries: cloneProgressionEntries(profile.entries),
    importedEntries: cloneProgressionEntries(profile.importedEntries),
  };
}

function entriesToRecord(
  entries: OperatorProgressionEntry[],
): Record<string, OperatorProgressionEntry> {
  return Object.fromEntries(entries.map((entry) => [entry.id, { ...entry }]));
}

function readState(): StoredProgressionState {
  if (typeof window === "undefined") {
    return { profiles: [], activeProfileId: "" };
  }
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (!isStoredState(value)) {
      return { profiles: [], activeProfileId: "" };
    }
    return {
      profiles: value.profiles.map(cloneProfile),
      activeProfileId: value.activeProfileId,
    };
  } catch {
    return { profiles: [], activeProfileId: "" };
  }
}

function readSettings(): StoredProgressionSettings {
  if (typeof window === "undefined") {
    return {
      treatSkillsAsUnlocked: false,
      showNoEditableOperators: false,
      showUnownedOperators: true,
    };
  }
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null",
    );
    return isRecord(value)
      ? {
          treatSkillsAsUnlocked:
            typeof value.treatSkillsAsUnlocked === "boolean"
              ? value.treatSkillsAsUnlocked
              : false,
          showNoEditableOperators:
            typeof value.showNoEditableOperators === "boolean"
              ? value.showNoEditableOperators
              : false,
          showUnownedOperators:
            typeof value.showUnownedOperators === "boolean"
              ? value.showUnownedOperators
              : false,
        }
      : {
          treatSkillsAsUnlocked: false,
          showNoEditableOperators: false,
          showUnownedOperators: false,
        };
  } catch {
    return {
      treatSkillsAsUnlocked: false,
      showNoEditableOperators: false,
      showUnownedOperators: false,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredEntry(value: unknown): value is OperatorProgressionEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.elite === 0 || value.elite === 1 || value.elite === 2) &&
    typeof value.level === "number" &&
    typeof value.owned === "boolean" &&
    typeof value.rarity === "number"
  );
}

function isStoredProfile(value: unknown): value is OperatorProgressionProfile {
  if (!isRecord(value)) {
    return false;
  }
  const entries = value.entries;
  const importedEntries = value.importedEntries;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isRecord(entries) &&
    Object.values(entries).every(isStoredEntry) &&
    isRecord(importedEntries) &&
    Object.values(importedEntries).every(isStoredEntry) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isStoredState(value: unknown): value is StoredProgressionState {
  return (
    isRecord(value) &&
    Array.isArray(value.profiles) &&
    value.profiles.every(isStoredProfile) &&
    typeof value.activeProfileId === "string"
  );
}

const initialState = readState();
const profiles = ref<OperatorProgressionProfile[]>(initialState.profiles);
const activeProfileId = ref(initialState.activeProfileId);
const initialSettings = readSettings();
const treatSkillsAsUnlocked = ref(initialSettings.treatSkillsAsUnlocked);
const showNoEditableOperators = ref(initialSettings.showNoEditableOperators);
const showUnownedOperators = ref(initialSettings.showUnownedOperators);

function persist(): void {
  profiles.value = [...profiles.value];
  if (typeof window === "undefined") {
    return;
  }
  try {
    const state: StoredProgressionState = {
      profiles: profiles.value.map(cloneProfile),
      activeProfileId: activeProfileId.value,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        treatSkillsAsUnlocked: treatSkillsAsUnlocked.value,
        showNoEditableOperators: showNoEditableOperators.value,
        showUnownedOperators: showUnownedOperators.value,
      }),
    );
  } catch {}
}

function normalizeActiveProfile(): void {
  if (activeProfileId.value === "") {
    return;
  }
  if (!profiles.value.some((profile) => profile.id === activeProfileId.value)) {
    activeProfileId.value = "";
  }
}

function uniqueName(name: string, excludedId = ""): string {
  const base = name.trim() || "未命名练度";
  const names = new Set(
    profiles.value
      .filter((profile) => profile.id !== excludedId)
      .map((profile) => profile.name),
  );
  if (!names.has(base)) {
    return base;
  }
  let index = 2;
  while (names.has(`${base} ${index}`)) {
    index += 1;
  }
  return `${base} ${index}`;
}

function createProfile(
  entries: OperatorProgressionEntry[],
  name: string,
): OperatorProgressionProfile {
  const timestamp = now();
  const record = entriesToRecord(entries);
  return {
    id: createId("progression"),
    name: uniqueName(name),
    entries: cloneProgressionEntries(record),
    importedEntries: cloneProgressionEntries(record),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function importProfile(
  value: unknown,
  fileName = "",
): OperatorProgressionProfile {
  const entries = parseOperatorProgressionImport(value);
  const profile = createProfile(
    entries,
    fileName.replace(/\.json$/i, "").trim() || "导入练度",
  );
  profiles.value.push(profile);
  activeProfileId.value = profile.id;
  persist();
  return profile;
}

function getProfile(id: string): OperatorProgressionProfile | undefined {
  return profiles.value.find((profile) => profile.id === id);
}

function setActiveProfile(id: string): void {
  if (id !== "" && !getProfile(id)) {
    return;
  }
  activeProfileId.value = id;
  persist();
}

function updateEntry(
  profileId: string,
  operatorId: string,
  update: (entry: OperatorProgressionEntry) => void,
): void {
  const profile = getProfile(profileId);
  const entry = profile?.entries[operatorId];
  if (!entry) {
    return;
  }
  update(entry);
  profile.updatedAt = now();
  persist();
}

function ensureEntry(profileId: string, entry: OperatorProgressionEntry): void {
  const profile = getProfile(profileId);
  if (!profile || profile.entries[entry.id]) {
    return;
  }
  profile.entries[entry.id] = { ...entry };
  profile.importedEntries[entry.id] = { ...entry };
  profile.updatedAt = now();
  persist();
}

function resetProfile(profileId: string): void {
  const profile = getProfile(profileId);
  if (!profile) {
    return;
  }
  profile.entries = cloneProgressionEntries(profile.importedEntries);
  profile.updatedAt = now();
  persist();
}

function resetEntry(profileId: string, operatorId: string): void {
  const profile = getProfile(profileId);
  const importedEntry = profile?.importedEntries[operatorId];
  if (!profile || !importedEntry) {
    return;
  }
  profile.entries[operatorId] = { ...importedEntry };
  profile.updatedAt = now();
  persist();
}

function duplicateProfile(
  profileId: string,
): OperatorProgressionProfile | undefined {
  const source = getProfile(profileId);
  if (!source) {
    return undefined;
  }
  const copy = cloneProfile(source);
  copy.id = createId("progression");
  copy.name = uniqueName(`${source.name} 副本`);
  copy.createdAt = now();
  copy.updatedAt = copy.createdAt;
  profiles.value.push(copy);
  activeProfileId.value = copy.id;
  persist();
  return copy;
}

function removeProfile(profileId: string): void {
  const index = profiles.value.findIndex((profile) => profile.id === profileId);
  if (index < 0) {
    return;
  }
  profiles.value.splice(index, 1);
  if (activeProfileId.value === profileId) {
    activeProfileId.value = profiles.value[index]?.id ?? "";
  }
  persist();
}

function renameProfile(profileId: string, name: string): void {
  const profile = getProfile(profileId);
  if (!profile) {
    return;
  }
  profile.name = uniqueName(name, profileId);
  profile.updatedAt = now();
  persist();
}

function setTreatSkillsAsUnlocked(value: boolean): void {
  treatSkillsAsUnlocked.value = value;
  persist();
}

function setShowNoEditableOperators(value: boolean): void {
  showNoEditableOperators.value = value;
  persist();
}

function setShowUnownedOperators(value: boolean): void {
  showUnownedOperators.value = value;
  persist();
}

normalizeActiveProfile();

const activeProfile = computed(() => getProfile(activeProfileId.value));

export function useOperatorProgression() {
  return {
    profiles,
    activeProfileId,
    activeProfile,
    treatSkillsAsUnlocked,
    showNoEditableOperators,
    showUnownedOperators,
    importProfile,
    getProfile,
    setActiveProfile,
    updateEntry,
    ensureEntry,
    resetEntry,
    resetProfile,
    duplicateProfile,
    removeProfile,
    renameProfile,
    setTreatSkillsAsUnlocked,
    setShowNoEditableOperators,
    setShowUnownedOperators,
    persist,
  };
}
