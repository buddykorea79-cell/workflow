import type { CommandExpectation, CommandTarget, TargetRevisionChange } from './command-targets';

export const revisionKey = (target: CommandTarget) => JSON.stringify([target.kind, target.id]);

/** Only server-confirmed changes made by this queue can advance an old draft. */
export function createRevisionChain() {
  const transitions = new Map<string, Map<number, number>>();
  return {
    clear() { transitions.clear(); },
    record(changes: readonly TargetRevisionChange[]) {
      for (const change of changes) {
        if (change.toRev <= change.fromRev) continue;
        const key = revisionKey(change);
        const chain = transitions.get(key) || new Map<number, number>();
        chain.set(change.fromRev, change.toRev);
        // Dropping ancient receipts causes a safe conflict, never an overwrite.
        if (chain.size > 1000) chain.delete(chain.keys().next().value!);
        transitions.set(key, chain);
      }
    },
    advance(expected: CommandExpectation, currentRev?: number): CommandExpectation {
      const chain = transitions.get(revisionKey(expected));
      let rev = expected.rev;
      const visited = new Set<number>();
      while (chain?.has(rev) && !visited.has(rev)) {
        visited.add(rev); rev = chain.get(rev)!;
      }
      return currentRev === undefined || rev === currentRev ? { ...expected, rev } : expected;
    },
  };
}
