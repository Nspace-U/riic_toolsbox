export interface OperatorPasteAssignment<TAddress, TEntry> {
  address: TAddress;
  entry: TEntry;
}

export function operatorPasteAssignments<TAddress, TEntry>(
  sourceEntries: readonly TEntry[],
  selectedTargets: readonly TAddress[],
  fallbackAssignments: readonly OperatorPasteAssignment<TAddress, TEntry>[],
): OperatorPasteAssignment<TAddress, TEntry>[] {
  const sourceEntry = sourceEntries.length === 1 ? sourceEntries[0] : undefined;
  if (sourceEntry !== undefined && selectedTargets.length > 1) {
    return selectedTargets.map((address) => ({
      address,
      entry: sourceEntry,
    }));
  }
  return [...fallbackAssignments];
}
