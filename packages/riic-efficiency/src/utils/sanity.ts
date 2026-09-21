export const DRONE_ACCELERATION_MINUTES = 3;

export type SanityFlowResource =
  | "龙门币"
  | "合成玉"
  | "赤金"
  | "中级作战记录"
  | "源石碎片"
  | "无人机"
  | "信用"
  | "公开招募标签刷新次数"
  | "固源岩"
  | "装置";

export type SanityResourceAmounts = Partial<Record<SanityFlowResource, number>>;
