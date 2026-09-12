export type OperatorAvatarOverlay = "unowned" | "training" | "mood";

export function getOperatorAvatarOverlay(
  operatorOwned: boolean,
  operatorTrainingUpgraded: boolean,
  moodScattered: boolean,
): OperatorAvatarOverlay | undefined {
  if (!operatorOwned) {
    return "unowned";
  }
  if (operatorTrainingUpgraded) {
    return "training";
  }
  if (moodScattered) {
    return "mood";
  }
  return undefined;
}
