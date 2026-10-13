import type { TorappuItemTable } from "@/types/torappu";
import type { TorappuBuildingData } from "@/utils/parseTorappuData";

export type EliteLevel = 0 | 1 | 2;

export interface OperatorAvatars {
  elite0: string;
  elite1: string;
  elite2: string;
}

export interface OperatorSkill {
  slot: string;
  unlockCondition: string;
  name: string;
  replacement: string;
  skillChain: string;
  facility: string;
  iconFile: string;
  iconStatus: string;
  description: string;
  termReferences: SkillTermReference[];
}

export interface Operator {
  id: string;
  name: string;
  maxEliteLevel?: EliteLevel;
  implementationDate?: string;
  implementationOrder?: number;
  isSpChar?: boolean;
  termReferences: SkillTermReference[];
  profession: string;
  branch: string;
  rarity: number;
  avatars: OperatorAvatars;
  skills: OperatorSkill[];
}

export interface SkillTermReference {
  key: string;
  name: string;
}

export interface SkillTerm {
  name: string;
  definition?: string;
  members?: string[];
}

export type BaseSkillTerms = Record<string, SkillTerm>;
export type RichTextStyles = Record<string, string>;

export interface BaseDataMetadata {
  versionId: number;
  source: string;
  sourceUrl: string;
  clientVersion: string;
  resVersion: string;
  syncedAt: string;
  missingAvatars?: string[];
  missingItemIcons?: string[];
  paths?: {
    characterTable?: string;
    charPatchTable?: string;
    buildingData?: string;
    gamedataConst?: string;
    itemTable?: string;
    avatars?: string;
    skillIcons?: string;
    itemIcons?: string;
    avatarMetadataIcons?: Record<
      string,
      {
        sourcePath: string;
        localPath: string;
      }
    >;
  };
}

export interface BaseData {
  operators: Operator[];
  operatorIdAliases: Record<string, string>;
  richTextStyles: RichTextStyles;
  terms: BaseSkillTerms;
  metadata?: BaseDataMetadata;
  itemTable?: TorappuItemTable;
  buildingData?: TorappuBuildingData;
}
