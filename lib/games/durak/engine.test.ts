/**
 * Durak deal sizes and the solo-player redeal offer.
 * Run: npx tsx lib/games/durak/engine.test.ts
 */
import { applyDurakAction, deal, emptyState, type DurakState } from "./engine";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function sit(state: DurakState, id: string, seat: number) {
  return applyDurakAction(
    state,
    { type: "sit", userId: id, name: id, seat },
    () => 0.1,
  );
}

const solo = sit(emptyState(), "ann", 0);
assert(solo.deckKind === 36, `1 human + bot uses 36, got ${solo.deckKind}`);
assert(solo.phase === "play", "solo deal starts");
assert(solo.seats.some((seat) => seat.isBot), "bot sits with one human");
assert(solo.anchorUserId === "ann", "anchor is the first player");

const joined = applyDurakAction(solo, {
  type: "sit",
  userId: "boris",
  name: "boris",
  seat: 2,
});
assert(joined.redealForUserId === "ann", "only the first player can redeal");
assert((joined.hands["2"] ?? []).length === 0, "new player waits for a redeal");

let thrown = false;
try {
  applyDurakAction(joined, { type: "redeal", userId: "boris" });
} catch {
  thrown = true;
}
assert(thrown, "newcomer cannot redeal");

const redealt = applyDurakAction(joined, { type: "redeal", userId: "ann" });
assert((redealt.hands["2"] ?? []).length === 6, "redeal gives the newcomer cards");
assert(redealt.deckKind === 36, `2 humans + bot stays on 36, got ${redealt.deckKind}`);

let full = emptyState();
for (const seat of [0, 2, 3, 4]) {
  full = applyDurakAction(
    full,
    { type: "sit", userId: `p${seat}`, name: `p${seat}`, seat },
    () => 0.2,
  );
}
deal(full);
assert(
  full.deckKind === 52,
  `4 humans + bot is 5 players and uses 52, got ${full.deckKind}`,
);

console.log("durak engine ok");
