import type { EliteLevel } from "./baseData";
import type { OperatorSkillFile } from "./efficiency";
import type { RoomKey } from "./schedule";

export interface OperatorProgressionEntry {
  id: string;
  name: string;
  elite: EliteLevel;
  level: number;
  owned: boolean;
  rarity: number;
}

export interface OperatorProgressionProfile {
  id: string;
  name: string;
  entries: Record<string, OperatorProgressionEntry>;
  importedEntries: Record<string, OperatorProgressionEntry>;
  createdAt: string;
  updatedAt: string;
}

export type ProgressionNodeType = "elite" | "level";

export interface OperatorProgressionNode {
  key: string;
  type: ProgressionNodeType;
  value: number;
  label: string;
  facilities: RoomKey[];
}

export interface ResolvedOperatorProgression {
  elite: EliteLevel;
  level: number;
  owned: boolean;
  upgraded: boolean;
}

export interface OperatorProgressionCalculationOptions {
  profile?: OperatorProgressionProfile;
  treatSkillsAsUnlocked?: boolean;
  dormitoryDefaultIncludesMoodRecovery?: boolean;
}

export interface OperatorProgressionResolverInput {
  operatorId: string;
  facility: RoomKey;
  operatorSkillFile?: OperatorSkillFile;
  maxEliteLevel?: EliteLevel;
  manualElite?: number;
  manualLevel?: number;
  profile?: OperatorProgressionProfile;
  treatSkillsAsUnlocked?: boolean;
  dormitoryDefaultIncludesMoodRecovery?: boolean;
}
