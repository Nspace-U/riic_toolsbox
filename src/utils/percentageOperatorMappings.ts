import type { RoomKey } from "@/types/schedule";

export interface PercentageOperatorMapping {
  room: RoomKey;
  product?: string;
  percentage: string;
  operators: string[];
}

export const PERCENTAGE_OPERATOR_MAPPINGS: PercentageOperatorMapping[] = [
  {
    room: "trading",
    percentage: "裁缝",
    operators: ["柏喙", "卡夫卡", "明椒", "折光"],
  },
  {
    room: "manufacture",
    product: "Battle Record",
    percentage: "35%",
    operators: ["断罪者", "食铁兽", "酒神", "弑君者", "裂响"],
  },
  {
    room: "manufacture",
    product: "Originium Shard",
    percentage: "35%",
    operators: ["艾雅法拉", "炎熔", "地灵", "锡兰"],
  },
  {
    room: "manufacture",
    percentage: "40%",
    operators: ["幽灵鲨", "斯卡蒂", "安哲拉", "乌尔比安"],
  },
  {
    room: "power",
    percentage: "20%",
    operators: ["格雷伊", "澄闪", "雷蛇", "炎狱炎熔", "海霓"],
  },
];

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
