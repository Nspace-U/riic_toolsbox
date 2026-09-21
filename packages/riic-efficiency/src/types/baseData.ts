export type EliteLevel = 0 | 1 | 2;

export interface SkillTermReference {
  key: string;
  name: string;
}

export interface Operator {
  id: string;
  name: string;
  maxEliteLevel?: EliteLevel;
  termReferences: SkillTermReference[];
  rarity: number;
}

export interface SkillTerm {
  name: string;
  definition?: string;
  members?: string[];
}

export type BaseSkillTerms = Record<string, SkillTerm>;
