import type {
  BaseDataMetadata,
  Operator,
  OperatorSkill,
  RichTextStyles,
  SkillTermReference,
} from "@/types/baseData";

export interface TorappuCharacter {
  name?: string;
  implementationDate?: string;
  implementationOrder?: number;
  isSpChar?: boolean;
  branch?: string;
  rarity?: string;
  profession?: string;
  subProfessionId?: string;
  phaseCount?: number;
  buffChar?: Array<{ buffData?: TorappuBuffData[] }>;
}

export interface TorappuCondition {
  phase?: string;
  level?: number;
}

export interface TorappuBuffData {
  buffId?: string;
  cond?: TorappuCondition;
}

export interface TorappuBuff {
  buffId?: string;
  buffName?: string;
  skillIcon?: string;
  roomType?: string;
  description?: string;
}

export interface TorappuCharacterTable {
  [operatorId: string]: TorappuCharacter;
}

export interface TorappuBuildingData {
  buffs?: Record<string, TorappuBuff>;
}

export interface TorappuTermDescription {
  termId?: string;
  termName?: string;
  description?: string;
}

export interface TorappuGamedataConst {
  richTextStyles?: RichTextStyles;
  termDescriptionDict?: Record<string, TorappuTermDescription>;
}

interface TorappuSkillRecord extends OperatorSkill {
  phase: number;
  level: number;
}

const PROFESSION_LABELS: Record<string, string> = {
  CASTER: "术师",
  MEDIC: "医疗",
  PIONEER: "先锋",
  SNIPER: "狙击",
  SPECIAL: "特种",
  SUPPORT: "辅助",
  TANK: "重装",
  WARRIOR: "近卫",
};

const FACILITY_LABELS: Record<string, string> = {
  CONTROL: "控制中枢",
  DORMITORY: "宿舍",
  HIRE: "办公室",
  MANUFACTURE: "制造站",
  MEETING: "会客室",
  POWER: "发电站",
  TRADING: "贸易站",
  TRAINING: "训练室",
  WORKSHOP: "加工站",
};

function rarityValue(value: string | undefined): number {
  const match = value?.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function professionLabel(value: string | undefined): string {
  return value ? (PROFESSION_LABELS[value] ?? value) : "";
}

function phaseValue(condition: TorappuCondition | undefined): number {
  const match = condition?.phase?.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function conditionLevel(condition: TorappuCondition | undefined): number {
  return condition?.level ?? 1;
}

function conditionLabel(condition: TorappuCondition | undefined): string {
  const phase = phaseValue(condition);
  const level = conditionLevel(condition);
  return level === 1 ? `精英${phase}` : `${level}级`;
}

function stripDescriptionTags(value: string): string {
  return value.replace(/<@[^>]+>/g, "").replace(/<\/>/g, "");
}

function extractTermReferences(
  description: string | undefined,
  terms: Record<string, TorappuTermDescription>,
  richTextStyles: RichTextStyles,
): SkillTermReference[] {
  const references = new Map<string, SkillTermReference>();
  const normalizedDescription = (description ?? "").replace(/<<(?=[$@])/g, "<");
  for (const match of normalizedDescription.matchAll(
    /<\$([^>]+)>([\s\S]*?)<\/>/g,
  )) {
    const key = match[1]?.trim();
    const name = stripDescriptionTags(match[2] ?? "").trim();
    if (
      key &&
      name &&
      !Object.hasOwn(richTextStyles, key) &&
      !references.has(key)
    ) {
      references.set(key, { key, name: terms[key]?.termName ?? name });
    }
  }
  return [...references.values()];
}

function extractOperatorTerms(
  skills: OperatorSkill[],
  terms: Record<string, TorappuTermDescription>,
): SkillTermReference[] {
  const references = new Map<string, SkillTermReference>();
  skills
    .flatMap((skill) => skill.termReferences)
    .forEach((reference) => {
      references.set(reference.key, {
        key: reference.key,
        name: terms[reference.key]?.termName ?? reference.name,
      });
    });
  return [...references.values()];
}

function avatarFileName(operatorId: string, eliteLevel: number): string {
  if (eliteLevel === 0) {
    return `${operatorId}.png`;
  }
  if (eliteLevel === 1) {
    return `${operatorId}_1+.png`;
  }
  return `${operatorId}_2.png`;
}

function buildAvatars(
  operatorId: string,
  character: TorappuCharacter,
  missingAvatars: Set<string>,
): Operator["avatars"] {
  const phaseCount = character.phaseCount ?? 0;
  const elite0 = avatarFileName(operatorId, 0);
  const elite1 = avatarFileName(operatorId, 1);
  const elite2 = avatarFileName(operatorId, 2);
  return {
    elite0: missingAvatars.has(elite0) ? "" : elite0,
    elite1: phaseCount >= 2 && !missingAvatars.has(elite1) ? elite1 : "",
    elite2: phaseCount >= 3 && !missingAvatars.has(elite2) ? elite2 : "",
  };
}

function buildReplacement(
  records: TorappuSkillRecord[],
  index: number,
): string {
  if (records.length === 1) {
    return records[0]?.slot === "1"
      ? "独立技能，无替换关系"
      : `独立技能（槽位${records[0]?.slot ?? "?"}技能，与其他槽位技能可同时生效）`;
  }

  const current = records[index];
  const previous = records[index - 1];
  const next = records[index + 1];
  const clauses: string[] = [];
  if (previous && current) {
    clauses.push(`在${current.unlockCondition}时替换「${previous.name}」`);
  }
  if (next && current) {
    clauses.push(`在${next.unlockCondition}时被「${next.name}」替换`);
  }
  return clauses.join("，");
}

function buildSkills(
  character: TorappuCharacter,
  buffs: Record<string, TorappuBuff>,
  terms: Record<string, TorappuTermDescription>,
  richTextStyles: RichTextStyles,
): OperatorSkill[] {
  const skills: OperatorSkill[] = [];

  for (const [slotIndex, slotData] of (character.buffChar ?? []).entries()) {
    const slot = String(slotIndex + 1);
    const records: TorappuSkillRecord[] = [];
    for (const buffData of slotData.buffData ?? []) {
      const buffId = buffData.buffId ?? "";
      const buff = buffs[buffId];
      if (!buff) {
        continue;
      }

      const unlockCondition = conditionLabel(buffData.cond);
      records.push({
        slot,
        unlockCondition,
        name: buff.buffName ?? buffId,
        replacement: "",
        skillChain: "",
        facility: FACILITY_LABELS[buff.roomType ?? ""] ?? buff.roomType ?? "",
        iconFile: buff.skillIcon ? `${buff.skillIcon}.png` : "",
        iconStatus: "正常",
        description: buff.description ?? "",
        termReferences: extractTermReferences(
          buff.description,
          terms,
          richTextStyles,
        ),
        phase: phaseValue(buffData.cond),
        level: conditionLevel(buffData.cond),
      });
    }

    records.sort(
      (left, right) => left.phase - right.phase || left.level - right.level,
    );
    const skillChain = records
      .map((record) => `${record.name}(${record.unlockCondition})`)
      .join(" → ");
    records.forEach((record, index) => {
      record.replacement = buildReplacement(records, index);
      record.skillChain = skillChain;
      const { phase: _phase, level: _level, ...skill } = record;
      void _phase;
      void _level;
      skills.push(skill);
    });
  }

  return skills;
}

export function parseTorappuData(
  characterTable: TorappuCharacterTable,
  buildingData: TorappuBuildingData,
  metadata: BaseDataMetadata,
  terms: Record<string, TorappuTermDescription> = {},
  richTextStyles: RichTextStyles = {},
): Operator[] {
  const buffs = buildingData.buffs ?? {};
  const missingAvatars = new Set(metadata.missingAvatars ?? []);
  const operators: Operator[] = [];

  for (const [operatorId, character] of Object.entries(characterTable)) {
    if (!operatorId.startsWith("char_")) {
      continue;
    }
    if (!character?.name) {
      continue;
    }

    const skills = buildSkills(character, buffs, terms, richTextStyles);
    operators.push({
      id: operatorId,
      name: character.name,
      implementationDate: character.implementationDate,
      implementationOrder: character.implementationOrder,
      isSpChar: character.isSpChar === true,
      profession: professionLabel(character.profession),
      branch: character.branch ?? character.subProfessionId ?? "",
      rarity: rarityValue(character.rarity),
      avatars: buildAvatars(operatorId, character, missingAvatars),
      termReferences: extractOperatorTerms(skills, terms),
      skills,
    });
  }

  return operators;
}
