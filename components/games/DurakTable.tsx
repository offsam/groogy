"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { DurakVoice } from "@/components/games/DurakVoice";
import { Button } from "@/components/ui/Button";
import {
  leaveDurakAction,
  passDurakAction,
  playDurakCardAction,
  redealDurakAction,
  refreshDurakAction,
  sitDurakAction,
  takeDurakAction,
  voteDurakBotAction,
  voteDurakModeAction,
} from "@/lib/games/durak/actions";
import {
  rankLabel,
  suitLabel,
  type Card,
  type DurakView,
  type Suit,
} from "@/lib/games/durak/engine";
import { cn } from "@/lib/utils";

const RED_SUITS = new Set<Suit>(["h", "d"]);

const IDLE_CARDS = [
  { rotate: -18, x: -54, y: 6 },
  { rotate: -6, x: -22, y: 16 },
  { rotate: 7, x: 8, y: 2 },
  { rotate: 18, x: 36, y: 12 },
  { rotate: -28, x: -8, y: -22 },
];

function seatPoint(index: number, yourSeat: number | null) {
  const shift = yourSeat ?? 0;
  const angle = Math.PI / 2 + ((index - shift) * 2 * Math.PI) / 7;
  return {
    left: `${50 + Math.cos(angle) * 34}%`,
    top: `${58 + Math.sin(angle) * 24}%`,
  };
}

const DECK_FROM = { left: "50%", top: "18%" };
const TABLE_AT = { left: "50%", top: "58%" };

type Flight = {
  key: string;
  fromLeft: string;
  fromTop: string;
  toLeft: string;
  toTop: string;
  delay: number;
  card?: Card;
};

function cardIds(view: DurakView): Set<string> {
  const ids = new Set<string>();
  for (const pair of view.table) {
    ids.add(pair.attack.id);
    if (pair.defense) ids.add(pair.defense.id);
  }
  return ids;
}

function tableCards(view: DurakView): Card[] {
  const cards: Card[] = [];
  for (const pair of view.table) {
    cards.push(pair.attack);
    if (pair.defense) cards.push(pair.defense);
  }
  return cards;
}

function flightsBetween(prev: DurakView, next: DurakView): Flight[] {
  const flights: Flight[] = [];
  let delay = 0;
  const lost: number[] = [];
  for (const seat of next.seats) {
    const before = prev.seats.find((item) => item.index === seat.index);
    const drop = (before?.cardCount ?? 0) - seat.cardCount;
    for (let i = 0; i < drop; i += 1) lost.push(seat.index);
  }
  const previousIds = cardIds(prev);
  let lostCursor = 0;
  for (const card of tableCards(next)) {
    if (previousIds.has(card.id)) continue;
    const fromSeat = lost[lostCursor] ?? next.yourSeat;
    lostCursor += 1;
    const from =
      fromSeat == null
        ? { left: "50%", top: "108%" }
        : fromSeat === next.yourSeat
          ? { left: "50%", top: "108%" }
          : seatPoint(fromSeat, next.yourSeat);
    flights.push({
      key: `play-${card.id}`,
      ...splitFrom(from),
      toLeft: TABLE_AT.left,
      toTop: TABLE_AT.top,
      delay,
      card,
    });
    delay += 70;
  }

  const prevTableSize = tableCards(prev).length;
  const taken =
    prevTableSize > 0 &&
    next.table.length === 0 &&
    next.seats.find((seat) => {
      const before = prev.seats.find((item) => item.index === seat.index);
      return seat.cardCount - (before?.cardCount ?? 0) >= prevTableSize;
    });
  if (taken) {
    const to = seatPoint(taken.index, next.yourSeat);
    flights.push({
      key: `take-${next.stockCount}-${taken.index}`,
      fromLeft: TABLE_AT.left,
      fromTop: TABLE_AT.top,
      toLeft: to.left,
      toTop: to.top,
      delay: 0,
    });
    return flights;
  }

  for (const seat of next.seats) {
    if (!seat.occupied) continue;
    const before = prev.seats.find((item) => item.index === seat.index);
    const gained = seat.cardCount - (before?.cardCount ?? 0);
    const to = seat.isYou
      ? { left: "50%", top: "108%" }
      : seatPoint(seat.index, next.yourSeat);
    for (let i = 0; i < Math.min(gained, 6); i += 1) {
      flights.push({
        key: `deal-${seat.index}-${next.stockCount}-${i}`,
        fromLeft: DECK_FROM.left,
        fromTop: DECK_FROM.top,
        toLeft: to.left,
        toTop: to.top,
        delay,
      });
      delay += 55;
    }
  }
  return flights;
}

function splitFrom(point: { left: string; top: string }) {
  return { fromLeft: point.left, fromTop: point.top };
}

function suitTone(suit: Suit) {
  return RED_SUITS.has(suit) ? "text-brand-red" : "text-slate-900";
}

function PlayingCard({
  card,
  playable,
  onPlay,
}: {
  card: Card;
  playable: boolean;
  onPlay?: (id: string) => void;
}) {
  const tone = suitTone(card.suit);
  return (
    <button
      className={cn(
        "relative flex h-[6.5rem] w-[4.4rem] shrink-0 flex-col justify-between rounded-xl border border-slate-200 bg-white px-1.5 py-1.5 text-left shadow-[0_8px_16px_rgba(15,40,20,0.28)]",
        playable ? "hover:-translate-y-2" : "",
      )}
      disabled={!playable}
      type="button"
      onClick={() => onPlay?.(card.id)}
    >
      <span className={cn("font-[family-name:var(--font-display)] text-lg font-semibold leading-none", tone)}>
        {rankLabel(card.rank)}
      </span>
      <span className={cn("self-center text-2xl leading-none", tone)}>{suitLabel(card.suit)}</span>
      <span className={cn("self-end rotate-180 font-[family-name:var(--font-display)] text-lg font-semibold leading-none", tone)}>
        {rankLabel(card.rank)}
      </span>
    </button>
  );
}

function CardBack({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-16 w-11 items-center justify-center rounded-lg border border-[#d7b56a]/80 bg-[#143056] shadow-[0_8px_14px_rgba(0,0,0,0.35)]",
        className,
      )}
    >
      <span className="flex h-12 w-8 items-center justify-center rounded border border-[#d7b56a]/70 text-xs font-semibold text-[#f3e2b3]">
        К
      </span>
    </span>
  );
}

function SeatFace({
  seat,
}: {
  seat: DurakView["seats"][number];
}) {
  const [broken, setBroken] = useState(false);
  const letter = seat.isBot ? "Б" : seat.name?.slice(0, 1) ?? "+";
  return (
    <span
      className={cn(
        "flex size-11 items-center justify-center overflow-hidden rounded-full border-2 text-xs font-semibold shadow-md",
        seat.isYou
          ? "border-[#f3e2b3] bg-brand-blue text-white"
          : seat.occupied
            ? "border-[#f3e2b3] bg-white text-slate-800"
            : "border-dashed border-white bg-white/90 text-brand-blue",
        seat.thinking ? "ring-2 ring-[#f3e2b3]" : "",
      )}
    >
      {seat.avatarUrl && !broken && !seat.isBot ? (
        <img
          alt=""
          className="size-full object-cover"
          src={seat.avatarUrl}
          onError={() => setBroken(true)}
        />
      ) : (
        letter
      )}
    </span>
  );
}

function FeltCard({ card, className }: { card: Card; className?: string }) {
  const tone = suitTone(card.suit);
  return (
    <span
      className={cn(
        "flex h-[4.6rem] w-12 flex-col justify-between rounded-lg border border-slate-200 bg-white px-1 py-1 shadow-[0_8px_14px_rgba(0,0,0,0.35)]",
        className,
      )}
    >
      <span className={cn("text-sm font-semibold leading-none", tone)}>
        {rankLabel(card.rank)}
        {suitLabel(card.suit)}
      </span>
      <span className={cn("self-center text-xl leading-none", tone)}>{suitLabel(card.suit)}</span>
    </span>
  );
}

export function DurakTable({
  initial,
  tableId,
}: {
  initial: DurakView;
  tableId: number;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [handStamp, setHandStamp] = useState(0);
  const [pending, startTransition] = useTransition();
  const returnPath = `/games/durak/${tableId}`;
  const previous = useRef<DurakView | null>(null);
  const freshCards = useRef(new Set<string>());
  const seenCards = useRef(new Set<string>(initial.yourCards.map((card) => card.id)));

  useEffect(() => {
    setView(initial);
  }, [initial]);

  useEffect(() => {
    const prev = previous.current;
    previous.current = view;
    if (!prev) return;
    const nextFlights = flightsBetween(prev, view).filter(
      (flight) => !flight.card || !seenCards.current.has(`fly-${flight.card.id}`),
    );
    let landed = false;
    for (const card of view.yourCards) {
      if (!seenCards.current.has(card.id)) {
        freshCards.current.add(card.id);
        landed = true;
      }
      seenCards.current.add(card.id);
    }
    for (const flight of nextFlights) {
      if (flight.card) seenCards.current.add(`fly-${flight.card.id}`);
    }
    if (landed) setHandStamp((value) => value + 1);
    if (nextFlights.length === 0) return;
    setFlights(nextFlights);
    const timer = window.setTimeout(() => setFlights([]), 1100);
    return () => window.clearTimeout(timer);
  }, [view]);

  useEffect(() => {
    let stopped = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      void refreshDurakAction(tableId).then((next) => {
        if (!stopped) setView(next);
      });
    }, 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pending, tableId]);

  function run(task: () => Promise<{ view: DurakView; message: string | null }>) {
    startTransition(async () => {
      const result = await task();
      setView(result.view);
      setMessage(result.message);
    });
  }

  function occupy(index: number, occupied: boolean) {
    if (occupied) return;
    if (!view.you) {
      router.push(`/login?next=${returnPath}`);
      return;
    }
    run(() => sitDurakAction(tableId, index));
  }

  function play(card: Card) {
    seenCards.current.add(`fly-${card.id}`);
    const from = { left: "50%", top: "108%" };
    setFlights([
      {
        key: `play-${card.id}`,
        fromLeft: from.left,
        fromTop: from.top,
        toLeft: TABLE_AT.left,
        toTop: TABLE_AT.top,
        delay: 0,
        card,
      },
    ]);
    run(() => playDurakCardAction(tableId, card.id));
  }

  const playable = view.canAttack || view.canDefend || view.canThrow;
  const modeLabel = view.mode === "podkidnoy" ? "Подкидной" : "Переводной";

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes durak-fly {
          from { left: var(--from-x); top: var(--from-y); opacity: 1; }
          to { left: var(--to-x); top: var(--to-y); opacity: 0.15; }
        }
        @keyframes durak-hand {
          from { transform: translateY(28px) scale(0.86); opacity: 0; }
          to { transform: none; opacity: 1; }
        }
      `}</style>
      <div>
        <Link className="text-sm font-medium text-brand-blue" href="/games/durak">
          Столы
        </Link>
        <div className="mt-1">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Стол {tableId}
          </h1>
          <p className="mt-1 text-sm text-slate-600">{view.status}</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            {modeLabel}
            {view.deckKind ? ` · колода ${view.deckKind}` : ""}
            {view.nextDeckKind && view.nextDeckKind !== view.deckKind
              ? ` · следующий кон ${view.nextDeckKind}`
              : ""}
          </p>
        </div>
      </div>

      {view.notice ? (
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
          {view.notice}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-3 py-2 text-sm text-slate-800">
          {message}
        </p>
      ) : null}

      <div className="relative mx-auto aspect-[4/5] w-full max-w-xl">
        <div className="absolute inset-x-8 inset-y-10 rounded-[2rem] bg-gradient-to-b from-[#8d5a32] via-[#5c3a1e] to-[#3a2414] p-1.5 shadow-[0_16px_30px_rgba(40,22,8,0.28)] sm:inset-x-10 sm:inset-y-12 sm:p-2">
          <div className="relative h-full overflow-hidden rounded-[1.6rem] bg-[radial-gradient(ellipse_at_50%_42%,#3eaf72_0%,#1d7c4a_46%,#0e5532_78%,#083d24_100%)] shadow-[inset_0_0_48px_rgba(0,0,0,0.45)]">
            <div
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(115deg, transparent 0 6px, rgba(255,255,255,0.035) 6px 7px)",
              }}
            />
            <div className="pointer-events-none absolute inset-2 rounded-[1.3rem] border border-[#e7c98a]/45" />

            {view.table.length === 0 && view.phase !== "play" ? (
              <div className="absolute left-1/2 top-[58%] h-16 w-28 -translate-x-1/2 -translate-y-1/2">
                {IDLE_CARDS.map((card) => (
                  <span
                    className="absolute left-1/2 top-1/2"
                    key={`${card.x}-${card.rotate}`}
                    style={{
                      transform: `translate(-50%, -50%) translate(${card.x}px, ${card.y}px) rotate(${card.rotate}deg)`,
                    }}
                  >
                    <CardBack />
                  </span>
                ))}
              </div>
            ) : (
              <div className="absolute left-1/2 top-[58%] flex max-w-[70%] -translate-x-1/2 -translate-y-1/2 flex-wrap items-center justify-center">
                {view.table.map((pair, index) => (
                  <div
                    className="relative mx-0.5"
                    key={pair.attack.id}
                    style={{ transform: `rotate(${(index - 1) * 7}deg)` }}
                  >
                    <FeltCard card={pair.attack} />
                    {pair.defense ? (
                      <FeltCard
                        card={pair.defense}
                        className="absolute left-3 top-3"
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="absolute left-1/2 top-2 flex -translate-x-1/2 flex-col items-center">
              <span className="relative h-16 w-11">
                {view.trumpSuit ? (
                  <span
                    className={cn(
                      "absolute -bottom-3 left-0.5 flex h-11 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-lg font-semibold shadow",
                      suitTone(view.trumpSuit),
                    )}
                  >
                    {suitLabel(view.trumpSuit)}
                  </span>
                ) : null}
                <span className="absolute left-0.5 top-1">
                  <CardBack />
                </span>
                <span className="absolute left-0 top-0">
                  <CardBack />
                </span>
                {view.stockCount > 0 ? (
                  <span className="absolute -right-2 -top-2 z-10 flex size-5 items-center justify-center rounded-full bg-[#f3e2b3] text-[10px] font-semibold text-[#3a2414]">
                    {view.stockCount}
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        </div>

        {flights.map((flight) => (
          <span
            className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
            key={flight.key}
            style={{
              animation: `durak-fly 620ms ease-out ${flight.delay}ms both`,
              ["--from-x" as string]: flight.fromLeft,
              ["--from-y" as string]: flight.fromTop,
              ["--to-x" as string]: flight.toLeft,
              ["--to-y" as string]: flight.toTop,
            }}
          >
            {flight.card ? <FeltCard card={flight.card} /> : <CardBack className="h-14 w-10" />}
          </span>
        ))}

        {view.seats.map((seat) => {
          const point = seatPoint(seat.index, view.yourSeat);
          const seatLeft = Number.parseFloat(point.left);
          return (
          <button
            className="absolute z-10 flex w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
            key={seat.index}
            style={point}
            type="button"
            onClick={() => occupy(seat.index, seat.occupied)}
          >
            <span className="relative">
              {seat.occupied && !seat.isYou && seat.cardCount > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute top-1 flex",
                    seatLeft < 46 ? "left-7" : "-left-3",
                  )}
                >
                  {Array.from({ length: Math.min(seat.cardCount, 2) }, (_, layer) => (
                    <span
                      className="h-6 w-4 rounded border border-[#d7b56a]/80 bg-[#143056] shadow-sm"
                      key={layer}
                      style={{ marginLeft: layer === 0 ? 0 : -8 }}
                    />
                  ))}
                </span>
              ) : null}
              <SeatFace seat={seat} />
              {seat.occupied && !seat.isYou && view.phase !== "waiting" ? (
                <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-[#f3e2b3] text-[10px] font-semibold text-[#3a2414]">
                  {seat.cardCount}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate rounded-full bg-white/90 px-1.5 text-[11px] leading-tight text-slate-700">
              {seat.occupied ? seat.name : "Занять"}
            </span>
          </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {view.canTake ? (
          <Button className="min-h-11" disabled={pending} onClick={() => run(() => takeDurakAction(tableId))}>
            Беру
          </Button>
        ) : null}
        {view.canPass ? (
          <Button className="min-h-11"
            disabled={pending}
            variant="secondary"
            onClick={() => run(() => passDurakAction(tableId))}
          >
            Бито
          </Button>
        ) : null}
        {view.canRedeal ? (
          <Button className="min-h-11" disabled={pending} onClick={() => run(() => redealDurakAction(tableId))}>
            Сдать заново
          </Button>
        ) : null}
        {view.yourSeat != null ? (
          <Button className="min-h-11"
            disabled={pending}
            variant="secondary"
            onClick={() => run(() => leaveDurakAction(tableId))}
          >
            Встать
          </Button>
        ) : null}
      </div>
      <DurakVoice tableId={tableId} />

      {view.canVoteMode ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">Режим следующего кона</p>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11"
              disabled={pending}
              variant="secondary"
              onClick={() => run(() => voteDurakModeAction(tableId, "podkidnoy"))}
            >
              Подкидной
            </Button>
            <Button className="min-h-11"
              disabled={pending}
              variant="secondary"
              onClick={() => run(() => voteDurakModeAction(tableId, "perevodnoy"))}
            >
              Переводной
            </Button>
          </div>
        </div>
      ) : null}

      {view.canVoteBot ? (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">Бот</p>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11"
              disabled={pending}
              variant="secondary"
              onClick={() => run(() => voteDurakBotAction(tableId, "keep"))}
            >
              Оставить
            </Button>
            <Button className="min-h-11" disabled={pending} onClick={() => run(() => voteDurakBotAction(tableId, "drop"))}>
              Убрать
            </Button>
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl border border-[#d7c4a3] bg-[#fffaf3] p-3 shadow-sm sm:p-4">
        <h2 className="text-sm font-semibold text-slate-900">Ваши карты</h2>
        {view.yourCards.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            {view.you
              ? "Когда сядете и начнётся кон, карты будут здесь. Чужие карты не показываются."
              : "Можно смотреть стол без входа. Чтобы сесть, войдите в аккаунт."}
          </p>
        ) : (
          <div className="mt-3 flex justify-center overflow-x-auto pb-2">
            <div className="flex items-end pl-1" data-hand={handStamp}>
              {view.yourCards.map((card, index) => (
                <span
                  className="-ml-3 first:ml-0"
                  key={card.id}
                  style={
                    freshCards.current.has(card.id)
                      ? {
                          animation: `durak-hand 480ms ease-out ${index * 70}ms both`,
                        }
                      : undefined
                  }
                >
                  <PlayingCard
                    card={card}
                    playable={playable && !pending}
                    onPlay={() => play(card)}
                  />
                </span>
              ))}
            </div>
          </div>
        )}
        {!view.you ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button className="min-h-11" onClick={() => router.push(`/login?next=${returnPath}`)}>Войти</Button>
            <Button className="min-h-11"
              variant="secondary"
              onClick={() => router.push(`/register?next=${returnPath}`)}
            >
              Регистрация
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
