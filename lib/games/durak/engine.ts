/** Подкидной / переводной дурак. Состояние считает только сервер. */

export const SEAT_COUNT = 7;

export const SUITS = ["s", "h", "d", "c"] as const;
export type Suit = (typeof SUITS)[number];

const RANKS_36 = ["6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
const RANKS_52 = ["2", "3", "4", "5", ...RANKS_36] as const;

export type DurakMode = "podkidnoy" | "perevodnoy";
export type Turn = "attack" | "defend" | "throw";

export type Card = { id: string; suit: Suit; rank: string };

export type Seat = {
  index: number;
  userId: string | null;
  name: string | null;
  isBot: boolean;
};

export type TablePair = { attack: Card; defense: Card | null };

export type DurakState = {
  seats: Seat[];
  mode: DurakMode;
  phase: "waiting" | "play" | "voting";
  stock: Card[];
  trumpSuit: Suit | null;
  trumpCard: Card | null;
  hands: Record<string, Card[]>;
  table: TablePair[];
  dealt: number[];
  finished: number[];
  attacker: number | null;
  defender: number | null;
  boutAttacker: number | null;
  turn: Turn | null;
  attackCap: number;
  throwPasses: number[];
  anchorUserId: string | null;
  redealForUserId: string | null;
  botVotes: Record<string, "keep" | "drop">;
  modeVotes: Record<string, DurakMode>;
  note: string | null;
  foolName: string | null;
  deckKind: 36 | 52 | null;
};

export type DurakView = {
  connected: boolean;
  notice: string | null;
  you: { id: string; name: string } | null;
  seats: Array<{
    index: number;
    name: string | null;
    isBot: boolean;
    occupied: boolean;
    isYou: boolean;
    cardCount: number;
    thinking: boolean;
  }>;
  phase: DurakState["phase"];
  mode: DurakMode;
  trumpSuit: Suit | null;
  trumpLabel: string | null;
  stockCount: number;
  deckKind: 36 | 52 | null;
  nextDeckKind: 36 | 52 | null;
  table: TablePair[];
  yourCards: Card[];
  yourSeat: number | null;
  canRedeal: boolean;
  canAttack: boolean;
  canDefend: boolean;
  canThrow: boolean;
  canPass: boolean;
  canTake: boolean;
  canVoteMode: boolean;
  canVoteBot: boolean;
  note: string | null;
  status: string;
};

export function emptyState(): DurakState {
  return {
    seats: Array.from({ length: SEAT_COUNT }, (_, index) => ({
      index,
      userId: null,
      name: null,
      isBot: false,
    })),
    mode: "podkidnoy",
    phase: "waiting",
    stock: [],
    trumpSuit: null,
    trumpCard: null,
    hands: {},
    table: [],
    dealt: [],
    finished: [],
    attacker: null,
    defender: null,
    boutAttacker: null,
    turn: null,
    attackCap: 0,
    throwPasses: [],
    anchorUserId: null,
    redealForUserId: null,
    botVotes: {},
    modeVotes: {},
    note: null,
    foolName: null,
    deckKind: null,
  };
}

const RANK_VALUE: Record<string, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export function rankLabel(rank: string): string {
  if (rank === "J") return "В";
  if (rank === "Q") return "Д";
  if (rank === "K") return "К";
  if (rank === "A") return "Т";
  return rank;
}

export function suitLabel(suit: Suit): string {
  if (suit === "s") return "♠";
  if (suit === "h") return "♥";
  if (suit === "d") return "♦";
  return "♣";
}

export function suitName(suit: Suit): string {
  if (suit === "s") return "пики";
  if (suit === "h") return "черви";
  if (suit === "d") return "бубны";
  return "трефы";
}

function humans(state: DurakState): Seat[] {
  return state.seats.filter((seat) => seat.userId);
}

function players(state: DurakState): Seat[] {
  return state.seats.filter((seat) => seat.userId || seat.isBot);
}

function hand(state: DurakState, seat: number): Card[] {
  return state.hands[String(seat)] ?? [];
}

function setHand(state: DurakState, seat: number, cards: Card[]) {
  state.hands[String(seat)] = cards;
}

function living(state: DurakState): number[] {
  return state.dealt.filter(
    (seat) => !state.finished.includes(seat) && hand(state, seat).length > 0,
  );
}

function nextLiving(state: DurakState, from: number): number | null {
  const order = state.dealt.filter((seat) => !state.finished.includes(seat));
  if (order.length === 0) return null;
  const start = order.findIndex((seat) => seat === from);
  for (let step = 1; step <= order.length; step += 1) {
    const seat = order[(Math.max(start, 0) + step) % order.length];
    if (hand(state, seat).length > 0 && seat !== from) return seat;
  }
  return null;
}

function beats(card: Card, attack: Card, trump: Suit): boolean {
  if (card.suit === attack.suit) {
    return RANK_VALUE[card.rank] > RANK_VALUE[attack.rank];
  }
  return card.suit === trump && attack.suit !== trump;
}

function buildDeck(kind: 36 | 52): Card[] {
  const ranks = kind === 36 ? RANKS_36 : RANKS_52;
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of ranks) {
      cards.push({ id: `${suit}${rank}`, suit, rank });
    }
  }
  return cards;
}

function shuffle(cards: Card[], random: () => number): Card[] {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = deck[i];
    deck[i] = deck[j];
    deck[j] = swap;
  }
  return deck;
}

function deckKindFor(count: number): 36 | 52 {
  return count <= 4 ? 36 : 52;
}

export function deal(state: DurakState, random: () => number = Math.random) {
  const seated = players(state);
  state.table = [];
  state.throwPasses = [];
  state.botVotes = {};
  state.modeVotes = {};
  state.foolName = null;
  state.redealForUserId = null;
  state.hands = {};
  state.finished = [];
  state.note = null;
  if (seated.length < 2) {
    state.phase = "waiting";
    state.stock = [];
    state.trumpSuit = null;
    state.trumpCard = null;
    state.deckKind = null;
    state.dealt = [];
    state.attacker = null;
    state.defender = null;
    state.boutAttacker = null;
    state.turn = null;
    state.attackCap = 0;
    const only = humans(state);
    state.anchorUserId = only.length === 1 ? only[0].userId : null;
    return;
  }
  const kind = deckKindFor(seated.length);
  const stock = shuffle(buildDeck(kind), random);
  const dealt = seated.map((seat) => seat.index);
  for (const seat of dealt) setHand(state, seat, []);
  for (let round = 0; round < 6; round += 1) {
    for (const seat of dealt) {
      const card = stock.pop();
      if (card) setHand(state, seat, [...hand(state, seat), card]);
    }
  }
  const trump = stock[0] ?? null;
  state.stock = stock;
  state.trumpCard = trump;
  state.trumpSuit = trump?.suit ?? null;
  state.deckKind = kind;
  state.dealt = dealt;
  state.phase = "play";
  state.attacker = dealt[0];
  state.defender = nextLiving(state, dealt[0]);
  state.boutAttacker = state.attacker;
  state.turn = "attack";
  state.attackCap = state.defender == null ? 0 : hand(state, state.defender).length;
  const only = humans(state);
  state.anchorUserId = only.length === 1 ? only[0].userId : null;
  state.note = `Сдано. Колода ${kind}. ${state.mode === "podkidnoy" ? "Подкидной" : "Переводной"}.`;
}

function ensureBot(state: DurakState) {
  if (state.seats.some((seat) => seat.isBot)) return;
  const free = state.seats.find((seat) => !seat.userId && !seat.isBot);
  if (!free) return;
  free.isBot = true;
  free.name = "Бот";
}

function removeBot(state: DurakState) {
  for (const seat of state.seats) {
    if (!seat.isBot) continue;
    seat.isBot = false;
    seat.name = null;
    delete state.hands[String(seat.index)];
  }
  state.dealt = state.dealt.filter(
    (seat) => state.seats[seat]?.userId || state.seats[seat]?.isBot,
  );
}

function seatOfUser(state: DurakState, userId: string): Seat | null {
  return state.seats.find((seat) => seat.userId === userId) ?? null;
}

function openAttack(state: DurakState): TablePair | null {
  return state.table.find((pair) => !pair.defense) ?? null;
}

function ranksOnTable(state: DurakState): Set<string> {
  const ranks = new Set<string>();
  for (const pair of state.table) {
    ranks.add(pair.attack.rank);
    if (pair.defense) ranks.add(pair.defense.rank);
  }
  return ranks;
}

function takeCard(state: DurakState, seat: number, cardId: string): Card | null {
  const cards = hand(state, seat);
  const card = cards.find((item) => item.id === cardId);
  if (!card) return null;
  setHand(
    state,
    seat,
    cards.filter((item) => item.id !== cardId),
  );
  return card;
}

function refill(state: DurakState) {
  const order = state.dealt.filter((seat) => !state.finished.includes(seat));
  const defender = state.defender;
  const sorted = [
    ...order.filter((seat) => seat !== defender),
    ...(defender == null ? [] : [defender]),
  ];
  for (const seat of sorted) {
    while (hand(state, seat).length < 6 && state.stock.length > 0) {
      const card = state.stock.pop();
      if (!card) break;
      setHand(state, seat, [...hand(state, seat), card]);
      if (state.stock.length === 0) state.trumpCard = null;
    }
  }
  if (state.stock.length === 0) {
    for (const seat of state.dealt) {
      if (hand(state, seat).length === 0 && !state.finished.includes(seat)) {
        state.finished.push(seat);
      }
    }
  }
}

function beginBout(state: DurakState, attacker: number | null) {
  state.table = [];
  state.throwPasses = [];
  const livingSeats = living(state);
  if (livingSeats.length <= 1) {
    finishHand(state, livingSeats[0] ?? null);
    return;
  }
  let nextAttacker = attacker;
  if (
    nextAttacker == null ||
    state.finished.includes(nextAttacker) ||
    hand(state, nextAttacker).length === 0
  ) {
    nextAttacker =
      attacker == null ? livingSeats[0] : nextLiving(state, attacker);
  }
  if (nextAttacker == null) {
    finishHand(state, null);
    return;
  }
  const defender = nextLiving(state, nextAttacker);
  if (defender == null) {
    finishHand(state, nextAttacker);
    return;
  }
  state.attacker = nextAttacker;
  state.boutAttacker = nextAttacker;
  state.defender = defender;
  state.turn = "attack";
  state.attackCap = hand(state, defender).length;
  state.phase = "play";
}

function finishBeaten(state: DurakState) {
  const nextAttacker = state.defender;
  refill(state);
  beginBout(state, nextAttacker);
}

function finishTaken(state: DurakState) {
  const defender = state.defender;
  if (defender != null) {
    const taken = state.table.flatMap((pair) =>
      pair.defense ? [pair.attack, pair.defense] : [pair.attack],
    );
    setHand(state, defender, [...hand(state, defender), ...taken]);
  }
  state.table = [];
  const after = defender == null ? null : nextLiving(state, defender);
  refill(state);
  beginBout(state, after);
}

function finishHand(state: DurakState, foolSeat: number | null) {
  state.phase = "voting";
  state.turn = null;
  state.table = [];
  state.attacker = null;
  state.defender = null;
  state.foolName =
    foolSeat == null ? null : (state.seats[foolSeat]?.name ?? "Игрок");
  const people = humans(state);
  if (people.length >= 3) removeBot(state);
  state.botVotes = {};
  state.modeVotes = {};
  state.note = state.foolName
    ? `${state.foolName} остаётся с картами. Можно выбрать режим на следующий кон.`
    : "Кон сыгран вничью. Можно выбрать режим на следующий кон.";
  if (people.length <= 1 && !players(state).some((seat) => seat.isBot)) {
    state.phase = "waiting";
  }
}

function maybeResolveVotes(state: DurakState, random: () => number) {
  if (state.phase !== "voting") return;
  const people = humans(state);
  if (people.length === 0) {
    removeBot(state);
    deal(state, random);
    return;
  }
  const allModes = people.every((seat) => state.modeVotes[seat.userId!]);
  const botStill = state.seats.some((seat) => seat.isBot);
  const needBot = botStill && people.length === 2;
  const allBot = !needBot || people.every((seat) => state.botVotes[seat.userId!]);
  if (!allModes || !allBot) return;
  const modes = people.map((seat) => state.modeVotes[seat.userId!]);
  if (modes.every((mode) => mode === modes[0])) state.mode = modes[0];
  if (needBot && Object.values(state.botVotes).includes("drop")) removeBot(state);
  if (humans(state).length === 1 && !state.seats.some((seat) => seat.isBot)) {
    ensureBot(state);
  }
  deal(state, random);
}

function throwers(state: DurakState): number[] {
  return state.dealt.filter(
    (seat) =>
      seat !== state.defender &&
      !state.finished.includes(seat) &&
      hand(state, seat).length > 0,
  );
}

function runBot(state: DurakState, random: () => number) {
  for (let guard = 0; guard < 24; guard += 1) {
    if (state.phase !== "play") return;
    const actorSeat =
      state.turn === "defend" ? state.defender : state.attacker;
    if (actorSeat == null || !state.seats[actorSeat]?.isBot) {
      if (state.turn !== "throw") return;
      const botThrower = throwers(state).find(
        (seat) =>
          state.seats[seat]?.isBot && !state.throwPasses.includes(seat),
      );
      if (botThrower == null) return;
      const playable = hand(state, botThrower).filter((card) =>
        ranksOnTable(state).has(card.rank),
      );
      if (
        playable.length === 0 ||
        state.table.length >= state.attackCap
      ) {
        state.throwPasses = [...state.throwPasses, botThrower];
        if (throwers(state).every((seat) => state.throwPasses.includes(seat))) {
          finishBeaten(state);
        }
        continue;
      }
      playable.sort(
        (a, b) =>
          (a.suit === state.trumpSuit ? 20 : 0) +
          RANK_VALUE[a.rank] -
          ((b.suit === state.trumpSuit ? 20 : 0) + RANK_VALUE[b.rank]),
      );
      applyPlay(state, botThrower, playable[0].id, random);
      continue;
    }
    const cards = [...hand(state, actorSeat)];
    if (state.turn === "attack") {
      const nonTrump = cards.filter((card) => card.suit !== state.trumpSuit);
      const pool = nonTrump.length > 0 ? nonTrump : cards;
      pool.sort((a, b) => RANK_VALUE[a.rank] - RANK_VALUE[b.rank]);
      applyPlay(state, actorSeat, pool[0].id, random);
      continue;
    }
    if (state.turn === "defend") {
      const target = openAttack(state);
      if (!target || !state.trumpSuit) {
        finishTaken(state);
        continue;
      }
      const answers = cards
        .filter((card) => beats(card, target.attack, state.trumpSuit!))
        .sort((a, b) => {
          const cost = (card: Card) =>
            (card.suit === state.trumpSuit ? 30 : 0) + RANK_VALUE[card.rank];
          return cost(a) - cost(b);
        });
      if (answers.length === 0) finishTaken(state);
      else applyPlay(state, actorSeat, answers[0].id, random);
      continue;
    }
    return;
  }
}

function applyPlay(
  state: DurakState,
  seat: number,
  cardId: string,
  random: () => number,
) {
  if (state.phase !== "play" || !state.trumpSuit) {
    throw new Error("Сейчас не ваш ход.");
  }
  if (!hand(state, seat).some((item) => item.id === cardId)) {
    throw new Error("Этой карты нет на руке.");
  }
  if (state.turn === "attack" && seat !== state.attacker) {
    throw new Error("Атакует другой игрок.");
  }
  if (state.turn === "defend" && seat !== state.defender) {
    throw new Error("Сейчас ходит защищающийся.");
  }
  const card = takeCard(state, seat, cardId);
  if (!card) throw new Error("Этой карты нет на руке.");

  if (state.turn === "attack") {
    state.table = [{ attack: card, defense: null }];
    state.turn = "defend";
    return;
  }

  if (state.turn === "defend") {
    if (seat !== state.defender) throw new Error("Сейчас ходит защищающийся.");
    const target = openAttack(state);
    if (!target) throw new Error("Нечего отбивать.");
    const canTransfer =
      state.mode === "perevodnoy" &&
      state.table.every((pair) => !pair.defense) &&
      state.table.every((pair) => pair.attack.rank === card.rank);
    if (canTransfer) {
      const next = nextLiving(state, seat);
      const attacks = state.table.length + 1;
      if (
        next != null &&
        next !== seat &&
        hand(state, next).length >= attacks
      ) {
        state.table.push({ attack: card, defense: null });
        state.attacker = seat;
        state.defender = next;
        state.attackCap = hand(state, next).length;
        state.turn = "defend";
        state.throwPasses = [];
        return;
      }
    }
    if (!beats(card, target.attack, state.trumpSuit)) {
      setHand(state, seat, [...hand(state, seat), card]);
      throw new Error("Эта карта не бьёт.");
    }
    target.defense = card;
    state.turn = openAttack(state) ? "defend" : "throw";
    state.throwPasses = [];
    return;
  }

  if (seat === state.defender) throw new Error("Подбрасывает другой игрок.");
  if (!ranksOnTable(state).has(card.rank)) {
    setHand(state, seat, [...hand(state, seat), card]);
    throw new Error("Подбросить можно только тот же ранг, что уже на столе.");
  }
  if (state.table.length >= state.attackCap) {
    setHand(state, seat, [...hand(state, seat), card]);
    throw new Error("Больше карт защищающийся не покроет.");
  }
  state.table.push({ attack: card, defense: null });
  state.turn = "defend";
  state.throwPasses = [];
  void random;
}

export type DurakAction =
  | { type: "sit"; userId: string; name: string; seat: number }
  | { type: "leave"; userId: string }
  | { type: "redeal"; userId: string }
  | { type: "play"; userId: string; cardId: string }
  | { type: "take"; userId: string }
  | { type: "pass"; userId: string }
  | { type: "vote-mode"; userId: string; mode: DurakMode }
  | { type: "vote-bot"; userId: string; choice: "keep" | "drop" };

export function applyDurakAction(
  input: DurakState,
  action: DurakAction,
  random: () => number = Math.random,
): DurakState {
  const state = structuredClone(input);

  if (action.type === "sit") {
    const seat = state.seats[action.seat];
    if (!seat || seat.userId || seat.isBot) {
      throw new Error("Это место уже занято.");
    }
    if (seatOfUser(state, action.userId)) {
      throw new Error("Вы уже сидите за столом.");
    }
    const before = humans(state).length;
    seat.userId = action.userId;
    seat.name = action.name.slice(0, 40) || "Игрок";
    if (before === 0) {
      ensureBot(state);
      deal(state, random);
    } else if (
      before === 1 &&
      state.phase === "play" &&
      state.anchorUserId
    ) {
      state.redealForUserId = state.anchorUserId;
      state.note = "За стол сел новый игрок. Можно сдать заново.";
    } else if (state.phase === "waiting") {
      ensureBot(state);
      deal(state, random);
    }
    runBot(state, random);
    return state;
  }

  if (action.type === "leave") {
    const seat = seatOfUser(state, action.userId);
    if (!seat) return state;
    delete state.hands[String(seat.index)];
    state.dealt = state.dealt.filter((index) => index !== seat.index);
    state.finished = state.finished.filter((index) => index !== seat.index);
    seat.userId = null;
    seat.name = null;
    if (humans(state).length === 0) {
      const blank = emptyState();
      blank.mode = state.mode;
      return blank;
    }
    if (state.phase === "play" || state.phase === "voting") {
      state.note = "Игрок вышел. Кон сдан заново.";
      if (humans(state).length === 1) ensureBot(state);
      deal(state, random);
    }
    runBot(state, random);
    return state;
  }

  if (action.type === "redeal") {
    if (state.redealForUserId !== action.userId) {
      throw new Error("Сдать заново может только тот, кто играл с ботом.");
    }
    deal(state, random);
    state.note = "Сдано заново, новый игрок в этой раздаче.";
    runBot(state, random);
    return state;
  }

  const seat = seatOfUser(state, action.userId);
  if (!seat) throw new Error("Сначала займите место.");

  if (action.type === "play") {
    applyPlay(state, seat.index, action.cardId, random);
    runBot(state, random);
    return state;
  }

  if (action.type === "take") {
    if (state.turn !== "defend" || state.defender !== seat.index) {
      throw new Error("Забрать карты может только защищающийся.");
    }
    finishTaken(state);
    runBot(state, random);
    return state;
  }

  if (action.type === "pass") {
    if (state.turn !== "throw" || seat.index === state.defender) {
      throw new Error("Сейчас нельзя спасовать.");
    }
    if (!state.throwPasses.includes(seat.index)) {
      state.throwPasses = [...state.throwPasses, seat.index];
    }
    if (throwers(state).every((index) => state.throwPasses.includes(index))) {
      finishBeaten(state);
    }
    runBot(state, random);
    return state;
  }

  if (action.type === "vote-mode") {
    if (state.phase !== "voting") throw new Error("Голосование ещё не началось.");
    state.modeVotes[action.userId] = action.mode;
    maybeResolveVotes(state, random);
    runBot(state, random);
    return state;
  }

  if (action.type === "vote-bot") {
    if (state.phase !== "voting") throw new Error("Голосование ещё не началось.");
    const people = humans(state);
    if (people.length !== 2 || !state.seats.some((item) => item.isBot)) {
      throw new Error("Сейчас бота не выбирают.");
    }
    state.botVotes[action.userId] = action.choice;
    maybeResolveVotes(state, random);
    runBot(state, random);
    return state;
  }

  return state;
}

function seatName(state: DurakState, seat: number | null): string {
  if (seat == null) return "ожидание";
  return state.seats[seat]?.name ?? "Игрок";
}

export function presentDurak(
  state: DurakState,
  you: { id: string; name: string } | null,
  extras?: { connected?: boolean; notice?: string | null },
): DurakView {
  const yourSeat =
    you == null
      ? null
      : (state.seats.find((seat) => seat.userId === you.id)?.index ?? null);
  const people = humans(state);
  const botStill = state.seats.some((seat) => seat.isBot);
  const yourTurnSeat =
    state.turn === "defend" ? state.defender : state.attacker;
  const canThrow =
    state.phase === "play" &&
    state.turn === "throw" &&
    yourSeat != null &&
    yourSeat !== state.defender &&
    hand(state, yourSeat).length > 0;
  const trumpLabel = state.trumpSuit
    ? `${suitName(state.trumpSuit)} ${suitLabel(state.trumpSuit)}`
    : null;
  let status = "Стол №1. Нажмите пустой кружок, чтобы занять место.";
  if (state.phase === "play") {
    const youAttack = yourSeat != null && yourSeat === state.attacker;
    const youDefend = yourSeat != null && yourSeat === state.defender;
    if (state.turn === "attack" && youAttack) status = "Ваш ход: выложите карту";
    else if (state.turn === "attack") {
      status = `Атакует ${seatName(state, state.attacker)}`;
    } else if (state.turn === "defend" && youDefend) {
      status = "Ваш ход: покройте карту или заберите";
    } else if (state.turn === "defend") {
      status = `Отбивается ${seatName(state, state.defender)}`;
    } else if (yourSeat != null && yourSeat !== state.defender) {
      status = "Можно подбросить карту того же ранга или сказать «бито»";
    } else status = "Ждём, подбросят ещё карты или скажут «бито»";
  } else if (state.phase === "voting") {
    status = state.note ?? "Голосование за следующий кон";
  } else if (players(state).length === 1) {
    status = "Ждём второго игрока. Пока можно сесть к боту — он сядет сам, когда сядете вы.";
  }

  return {
    connected: extras?.connected ?? true,
    notice: extras?.notice ?? null,
    you,
    seats: state.seats.map((seat) => ({
      index: seat.index,
      name: seat.name,
      isBot: seat.isBot,
      occupied: Boolean(seat.userId || seat.isBot),
      isYou: yourSeat === seat.index,
      cardCount: hand(state, seat.index).length,
      thinking:
        state.phase === "play" &&
        (seat.index === yourTurnSeat ||
          (state.turn === "throw" &&
            seat.index !== state.defender &&
            seat.isBot &&
            !state.throwPasses.includes(seat.index))),
    })),
    phase: state.phase,
    mode: state.mode,
    trumpSuit: state.trumpSuit,
    trumpLabel,
    stockCount: state.stock.length,
    deckKind: state.deckKind,
    nextDeckKind:
      players(state).length >= 2
        ? players(state).length <= 4
          ? 36
          : 52
        : null,
    table: state.table,
    yourCards: yourSeat == null ? [] : hand(state, yourSeat),
    yourSeat,
    canRedeal: Boolean(you && state.redealForUserId === you.id),
    canAttack:
      state.phase === "play" &&
      state.turn === "attack" &&
      yourSeat != null &&
      yourSeat === state.attacker,
    canDefend:
      state.phase === "play" &&
      state.turn === "defend" &&
      yourSeat != null &&
      yourSeat === state.defender,
    canThrow,
    canPass: canThrow,
    canTake:
      state.phase === "play" &&
      state.turn === "defend" &&
      yourSeat != null &&
      yourSeat === state.defender,
    canVoteMode: state.phase === "voting" && yourSeat != null && you != null,
    canVoteBot:
      state.phase === "voting" &&
      yourSeat != null &&
      you != null &&
      botStill &&
      people.length === 2,
    note: state.note,
    status,
  };
}
