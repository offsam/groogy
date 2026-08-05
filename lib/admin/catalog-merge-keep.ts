/**
 * Who should survive a catalog glue (business ↔ professional / same type).
 * Richer fill wins; on a tie prefer professional (recommendations / services).
 * Never hard-code «business always wins».
 */
export function preferKeepSelfByFill(input: {
  selfKind: "business" | "professional";
  candidateKind: "business" | "professional";
  selfFill: number;
  candidateFill: number;
}): boolean {
  const fillDiff = input.selfFill - input.candidateFill;
  if (fillDiff !== 0) return fillDiff > 0;
  if (input.selfKind === input.candidateKind) return true;
  return input.selfKind === "professional";
}
