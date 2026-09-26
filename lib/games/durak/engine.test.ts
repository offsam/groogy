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

function card(id: string, suit: "s" | "h" | "d" | "c", rank: string) {
  return { id, suit, rank };
}

function seated(count: number) {
  const state = emptyState();
  for (let index = 0; index < count; index += 1) {
    state.seats[index].userId = `p${index}`;
    state.seats[index].name = `p${index}`;
  }
  deal(state);
  return state;
}

function deckIds(state: DurakState) {
  const ids = state.dealt.flatMap((seat) => (state.hands[String(seat)] ?? []).map((item) => item.id));
  ids.push(...state.stock.map((item) => item.id));
  return ids;
}

const signatures = new Set<string>();
const firstCard = new Map<string, number>();
for (const count of [2, 3, 4, 6, 7]) {
  for (let run = 0; run < 400; run += 1) {
    const state = seated(count);
    const expected = count <= 4 ? 36 : 52;
    const ids = deckIds(state);
    assert(ids.length === expected, `${count} players deal ${ids.length}, expected ${expected}`);
    assert(new Set(ids).size === ids.length, `${count} players have a duplicate card`);
    for (const seat of state.dealt) {
      assert((state.hands[String(seat)] ?? []).length === 6, `${count} players: seat ${seat} did not get 6`);
    }
    assert(state.stock.length === expected - count * 6, `${count} players stock size`);
    assert(state.trumpCard?.id === state.stock[0]?.id, "trump is the bottom of the remaining stock");
    assert(state.trumpSuit === state.trumpCard?.suit, "trump suit follows the trump card");
    const signature = ids.join(",");
    signatures.add(signature);
    const dealtFirst = state.hands[String(state.dealt[0])]?.[0]?.id ?? "";
    firstCard.set(dealtFirst, (firstCard.get(dealtFirst) ?? 0) + 1);
  }
}
assert(signatures.size > 1000, `deals reused a deck, unique sequences ${signatures.size}`);
const busiest = Math.max(...firstCard.values());
assert(busiest < 400, `first dealt card repeats too often (${busiest}), shuffle looks stuck`);

function scripted() {
  const state = emptyState();
  state.seats[0].userId = "ann";
  state.seats[0].name = "Анна";
  state.seats[1].userId = "bor";
  state.seats[1].name = "Борис";
  state.phase = "play";
  state.dealt = [0, 1];
  state.attacker = 0;
  state.defender = 1;
  state.boutAttacker = 0;
  state.turn = "attack";
  state.trumpSuit = "s";
  state.trumpCard = null;
  state.stock = [];
  state.deckKind = 36;
  state.attackCap = 6;
  state.hands = {
    "0": [card("h6", "h", "6"), card("c6", "c", "6"), card("dK", "d", "K")],
    "1": [card("c9", "c", "9"), card("h9", "h", "9"), card("sJ", "s", "J")],
  };
  return state;
}

let bout = scripted();
let refused = false;
try {
  bout = applyDurakAction(bout, { type: "play", userId: "bor", cardId: "c9" });
} catch {
  refused = true;
}
assert(refused, "defender cannot attack");

bout = applyDurakAction(scripted(), { type: "play", userId: "ann", cardId: "h6" });
assert(bout.table.length === 1 && bout.turn === "defend", "one attack opens the defense");
refused = false;
try {
  bout = applyDurakAction(bout, { type: "play", userId: "bor", cardId: "c9" });
} catch {
  refused = true;
}
assert(refused, "a card of another suit does not defend");
assert(bout.hands["1"]?.some((item) => item.id === "c9"), "failed defense returns the card");

bout = applyDurakAction(bout, { type: "play", userId: "bor", cardId: "h9" });
assert(bout.turn === "throw" && bout.table[0]?.defense?.id === "h9", "higher hearts beats the attack");
refused = false;
try {
  applyDurakAction(bout, { type: "play", userId: "ann", cardId: "dK" });
} catch {
  refused = true;
}
assert(refused, "cannot add a rank that is not on the table");
bout = applyDurakAction(bout, { type: "play", userId: "ann", cardId: "c6" });
assert(bout.table.length === 2 && bout.turn === "defend", "matching rank can be added");
bout = applyDurakAction(bout, { type: "play", userId: "bor", cardId: "sJ" });
assert(bout.turn === "throw", "trump covers a non-trump");
const beforePass = bout.hands["0"]?.length ?? 0;
bout = applyDurakAction(bout, { type: "pass", userId: "ann" });
assert(bout.table.length === 0, "a beaten round clears the table");
assert((bout.hands["0"]?.length ?? 0) === beforePass, "beaten cards are not taken into a hand");

let taken = scripted();
taken.hands["1"] = [card("c9", "c", "9")];
taken = applyDurakAction(taken, { type: "play", userId: "ann", cardId: "h6" });
taken = applyDurakAction(taken, { type: "take", userId: "bor" });
assert(taken.table.length === 0, "take clears the table");
assert(taken.hands["1"]?.some((item) => item.id === "h6"), "defender receives the attack");
assert(taken.phase === "play", "the next bout starts");

let ending = scripted();
ending.hands = {
  "0": [card("h6", "h", "6")],
  "1": [card("c9", "c", "9")],
};
ending.attackCap = 1;
ending = applyDurakAction(ending, { type: "play", userId: "ann", cardId: "h6" });
ending = applyDurakAction(ending, { type: "take", userId: "bor" });
assert(ending.phase === "voting", "the last player with cards is the fool");
assert(ending.foolName === "Борис", `fool is Борис, got ${ending.foolName}`);

let crowded = emptyState();
for (let seat = 0; seat < 7; seat += 1) {
  crowded.seats[seat].userId = `u${seat}`;
  crowded.seats[seat].name = `u${seat}`;
}
let blocked = false;
try {
  crowded = applyDurakAction(crowded, { type: "sit", userId: "extra", name: "extra", seat: 0 });
} catch {
  blocked = true;
}
assert(blocked, "two people cannot take the same seat");
crowded = applyDurakAction(crowded, { type: "leave", userId: "u0" });
const freed = applyDurakAction(crowded, { type: "sit", userId: "extra", name: "extra", seat: 0 });
assert(freed.seats[0]?.userId === "extra", "a free seat can be taken");

console.log("durak scenarios ok");

