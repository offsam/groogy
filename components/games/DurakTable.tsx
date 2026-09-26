"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Eye, LogOut, Mic, MicOff, User, Users, Volume2, VolumeX } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { DurakChat } from "@/components/games/DurakChat";
import { useDurakVoice, type SeatVoice } from "@/components/games/DurakVoice";
import { useDurakRoom } from "@/components/games/useDurakRoom";
import {
  feltComposition,
  seatCenter,
  seatPercent,
  TABLE_OVERHANG,
  visualSlot,
} from "@/components/games/durak-table-geometry";
import "@/components/games/durak-felt.css";
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

const FELT_FALLBACK = { w: 360, h: 511 };
const DECK_FROM = { left: "50%", top: "13%" };
const TABLE_AT = { left: "50%", top: "56%" };

function seatPoint(
  index: number,
  yourSeat: number | null,
  box: { w: number; h: number },
) {
  return seatPercent(index, yourSeat, box.w, box.h);
}

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

function flightsBetween(
  prev: DurakView,
  next: DurakView,
  box: { w: number; h: number },
): Flight[] {
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
          : seatPoint(fromSeat, next.yourSeat, box);
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
    const to = seatPoint(taken.index, next.yourSeat, box);
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
      : seatPoint(seat.index, next.yourSeat, box);
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
  picked,
  onPlay,
}: {
  card: Card;
  playable: boolean;
  picked: boolean;
  onPlay?: (id: string) => void;
}) {
  const tone = suitTone(card.suit);
  return (
    <button
      className={cn(
        "relative flex h-[4.9rem] w-[3.3rem] shrink-0 flex-col justify-between rounded-lg border border-white/80 bg-white px-1 py-1 text-left shadow-[0_10px_16px_rgba(0,0,0,0.42)]",
        picked
          ? "-translate-y-2 border-[#f6e2b0] ring-2 ring-[#f6e2b0]"
          : "border-slate-200",
        playable ? "" : "opacity-90",
      )}
      disabled={!playable}
      type="button"
      onClick={() => onPlay?.(card.id)}
    >
      <span className={cn("font-[family-name:var(--font-display)] text-sm font-semibold leading-none", tone)}>
        {rankLabel(card.rank)}
      </span>
      <span className={cn("self-center text-lg leading-none", tone)}>{suitLabel(card.suit)}</span>
      <span className={cn("self-end rotate-180 font-[family-name:var(--font-display)] text-sm font-semibold leading-none", tone)}>
        {rankLabel(card.rank)}
      </span>
    </button>
  );
}

function CardBack({ size = "sm" }: { size?: "xs" | "peek" | "sm" | "deck" | "lg" }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-md border border-[#f0d7a2] bg-[radial-gradient(circle_at_40%_30%,#c43b48_0%,#8d1d2c_55%,#5c1018_100%)] shadow-[0_8px_14px_rgba(0,0,0,0.28)]",
        size === "lg"
          ? "h-[4.9rem] w-[3.3rem] rounded-lg"
          : size === "deck"
            ? "h-[3.3rem] w-[2.35rem]"
            : size === "peek"
              ? "h-10 w-7"
              : size === "xs"
                ? "h-7 w-5"
                : "h-11 w-8",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-sm border border-[#f0d7a2]/80 font-semibold text-[#f8e7c4]",
          size === "lg"
            ? "h-12 w-8 text-xs"
            : size === "deck"
              ? "h-8 w-5 text-[9px]"
              : size === "peek"
                ? "h-6 w-4 text-[8px]"
                : size === "xs"
                  ? "h-4 w-3 text-[7px]"
                  : "h-7 w-5 text-[9px]",
        )}
      >
        К
      </span>
    </span>
  );
}

function SeatFace({
  seat,
  speaking,
}: {
  seat: DurakView["seats"][number];
  speaking?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const photo = Boolean(seat.avatarUrl && !broken && seat.occupied && !seat.isBot);
  return (
    <span
      className={cn(
        "relative z-10 flex size-14 items-center justify-center overflow-hidden rounded-full border-2 shadow-[0_10px_16px_rgba(0,0,0,0.45)]",
        seat.occupied
          ? "border-[#f6e2b0] bg-[#1c2430] text-white"
          : "border-white/30 bg-white/10 text-white shadow-none backdrop-blur-[2px]",
        speaking ? "durak-speaking ring-2 ring-brand-green" : "",
        seat.thinking && !speaking ? "ring-2 ring-[#f3e2b3]" : "",
      )}
    >
      {photo ? (
        <img
          alt=""
          className="size-full object-cover"
          src={seat.avatarUrl ?? ""}
          onError={() => setBroken(true)}
        />
      ) : seat.occupied ? (
        <User aria-hidden className="size-7 text-white/80" />
      ) : (
        <span className="relative text-white/70">
          <User aria-hidden className="size-7" />
          <span className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full border border-white/30 bg-black/50 text-[10px] leading-none">
            +
          </span>
        </span>
      )}
    </span>
  );
}

function FeltCard({ card, className }: { card: Card; className?: string }) {
  const tone = suitTone(card.suit);
  return (
    <span
      className={cn(
        "flex h-[5.2rem] w-[3.5rem] flex-col justify-between rounded-lg border border-white/70 bg-white px-1 py-1 shadow-[0_10px_16px_rgba(0,0,0,0.4)]",
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

function HandFan({
  boxWidth,
  cards,
  fresh,
  handDrag,
  hiddenFan,
  pending,
  picked,
  playable,
  stamp,
  onChoose,
}: {
  boxWidth: number;
  cards: Card[];
  fresh: { current: Set<string> };
  handDrag: { current: boolean };
  hiddenFan: number;
  pending: boolean;
  picked: string | null;
  playable: boolean;
  stamp: number;
  onChoose: (card: Card) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const count = cards.length || hiddenFan;
  const viewW = Math.max(160, Math.round(boxWidth * 0.68));
  const cardW = 53;
  const roomy = count <= 1 ? cardW : (viewW - cardW) / (count - 1);
  const step = count <= 1 ? 0 : roomy >= 16 ? Math.min(32, roomy) : 16;
  const content = cardW + Math.max(0, count - 1) * step;
  const scrolling = content > viewW + 1;
  const ids = cards.length > 0
    ? cards.map((card) => card.id)
    : Array.from({ length: hiddenFan }, (_, index) => `back-${index}`);
  const offset = scrolling ? 0 : Math.max(0, (viewW - content) / 2);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !scrolling) {
      setEdges({ left: false, right: false });
      return;
    }
    const sync = () => {
      setEdges({
        left: el.scrollLeft > 6,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 6,
      });
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    return () => el.removeEventListener("scroll", sync);
  }, [scrolling, count, viewW]);

  return (
    <div
      className="absolute left-1/2 z-20 h-[6.4rem] -translate-x-1/2"
      style={{ bottom: -20, width: viewW }}
    >
      {edges.left ? (
        <button
          aria-label="Предыдущие карты"
          className="absolute top-1/2 left-0 z-30 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white shadow-sm"
          type="button"
          onClick={() => scroller.current?.scrollBy({ left: -viewW * 0.55, behavior: "smooth" })}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </button>
      ) : null}
      {edges.right ? (
        <button
          aria-label="Следующие карты"
          className="absolute top-1/2 right-0 z-30 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white shadow-sm"
          type="button"
          onClick={() => scroller.current?.scrollBy({ left: viewW * 0.55, behavior: "smooth" })}
        >
          <ChevronRight aria-hidden className="size-4" />
        </button>
      ) : null}
      <div
        className={cn("durak-hand h-full", scrolling ? "overflow-x-auto" : "overflow-visible")}
        data-hand={stamp}
        ref={scroller}
        style={{ touchAction: "pan-x" }}
        onPointerDown={(event) => {
          handDrag.current = false;
          event.currentTarget.dataset.x = String(event.clientX);
        }}
        onPointerMove={(event) => {
          const start = Number(event.currentTarget.dataset.x ?? event.clientX);
          if (Math.abs(event.clientX - start) > 10) handDrag.current = true;
        }}
        onPointerUp={() => {
          window.setTimeout(() => {
            handDrag.current = false;
          }, 40);
        }}
      >
        <div className="relative h-full" style={{ width: scrolling ? content : viewW }}>
          {ids.map((id, index) => {
            const card = cards[index];
            const shift = index - (count - 1) / 2;
            const lifted = card ? picked === card.id : false;
            return (
              <span
                className={cn("absolute bottom-1", card ? "pointer-events-auto" : "pointer-events-none")}
                key={id}
                style={{
                  left: offset + index * step,
                  zIndex: lifted ? 30 : index + 1,
                  transform: `translateY(${lifted ? -16 : Math.abs(shift) * 5}px) rotate(${shift * 5}deg)`,
                  transformOrigin: "50% 180%",
                }}
              >
                <span
                  className="block"
                  style={
                    card && fresh.current.has(card.id)
                      ? { animation: `durak-hand 480ms ease-out ${index * 70}ms both` }
                      : undefined
                  }
                >
                  {card ? (
                    <PlayingCard
                      card={card}
                      picked={lifted}
                      playable={playable && !pending}
                      onPlay={() => onChoose(card)}
                    />
                  ) : (
                    <CardBack size="lg" />
                  )}
                </span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
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
  const [picked, setPicked] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const voice = useDurakVoice(tableId);
  const handDrag = useRef(false);
  const seatedIds = view.seats.flatMap((seat) => (seat.userId ? [seat.userId] : []));
  const freeSeat = view.seats.some((seat) => !seat.occupied);
  const room = useDurakRoom(
    tableId,
    {
      userId: view.you?.id ?? null,
      seated: view.yourSeat != null,
      queued: queued && !freeSeat && view.yourSeat == null,
    },
    seatedIds,
  );
  const returnPath = `/games/durak/${tableId}`;
  const previous = useRef<DurakView | null>(null);
  const freshCards = useRef(new Set<string>());
  const seenCards = useRef(new Set<string>(initial.yourCards.map((card) => card.id)));
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const feltBox = useRef(FELT_FALLBACK);
  const [box, setBox] = useState({ ...FELT_FALLBACK, scale: 1, gap: 16, stageH: 560 });

  useEffect(() => {
    setView(initial);
  }, [initial]);

  useEffect(() => {
    const prev = previous.current;
    previous.current = view;
    if (!prev) return;
    const nextFlights = flightsBetween(prev, view, feltBox.current).filter(
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
    const shell = shellRef.current;
    const header = headerRef.current;
    if (!shell || !header) return;
    const measure = () => {
      const shellH = shell.clientHeight;
      const shellW = shell.clientWidth;
      const headerH = header.offsetHeight;
      const gap = shellH < 700 ? 12 : 18;
      const chatFloor = shellH <= 620 ? 118 : shellH <= 760 ? 140 : 160;
      const available = Math.max(180, shellH - headerH - chatFloor - gap);
      const next = feltComposition(shellW, available);
      feltBox.current = { w: next.width, h: next.height };
      const stageH = Math.round(gap + next.scale * (next.height + TABLE_OVERHANG));
      setBox({ w: next.width, h: next.height, scale: next.scale, gap, stageH });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (view.yourSeat != null || freeSeat) setQueued(false);
  }, [view.yourSeat, freeSeat]);

  useEffect(() => {
    const shell = shellRef.current;
    const viewport = window.visualViewport;
    if (!shell || !viewport) return;
    const pin = () => {
      shell.style.top = `${viewport.offsetTop}px`;
      shell.style.height = `${viewport.height}px`;
      window.scrollTo(0, 0);
    };
    pin();
    viewport.addEventListener("resize", pin);
    viewport.addEventListener("scroll", pin);
    return () => {
      viewport.removeEventListener("resize", pin);
      viewport.removeEventListener("scroll", pin);
      shell.style.top = "";
      shell.style.height = "";
    };
  }, []);

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

  function choose(card: Card) {
    if (handDrag.current || !playable || pending) return;
    if (picked !== card.id) {
      setPicked(card.id);
      return;
    }
    setPicked(null);
    play(card);
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
  const youSeat = view.seats.find((seat) => seat.isYou);
  const bottomSeat = view.seats.find((seat) => visualSlot(seat.index, view.yourSeat) === 0);
  const hiddenFan =
    view.yourCards.length === 0 && bottomSeat?.occupied && bottomSeat.cardCount > 0 && view.phase !== "waiting"
      ? Math.min(bottomSeat.cardCount, 6)
      : 0;

  function exitTable() {
    if (view.yourSeat == null) {
      router.push("/games/durak");
      return;
    }
    startTransition(async () => {
      await leaveDurakAction(tableId);
      router.push("/games/durak");
    });
  }

  return (
    <div ref={shellRef} className="game-shell fixed top-0 left-1/2 z-[1100] flex h-dvh max-h-dvh w-full max-w-xl -translate-x-1/2 flex-col overflow-hidden">
      {voice.audio}
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
      <header ref={headerRef} className="flex shrink-0 flex-wrap items-center gap-2 px-3 pt-[max(0.25rem,env(safe-area-inset-top))] pb-1">
        <Link className="inline-flex size-11 items-center justify-center" href="/" title="КРУГИ">
          <BrandMark priority size={32} />
        </Link>
        <h1 className="min-w-0 font-[family-name:var(--font-display)] text-lg font-semibold text-white">
          Дурак
        </h1>
        <div className="ml-auto flex items-center gap-1">
          <span
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-black/35 px-2.5 text-sm font-semibold text-white shadow-[0_4px_10px_rgba(0,0,0,0.28)]"
            title="Очки"
          >
            <span aria-hidden className="size-4 rounded-full bg-brand-yellow shadow-inner" />
            1 250
          </span>
          <button
            aria-label="Покинуть стол"
            className="flex size-11 items-center justify-center rounded-full border border-white/15 bg-black/35 text-white shadow-[0_4px_10px_rgba(0,0,0,0.28)]"
            type="button"
            onClick={exitTable}
          >
            <LogOut aria-hidden className="size-5" />
          </button>
        </div>
        <div className="flex basis-full justify-center pt-1">
          <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-[11px] text-white shadow-[0_4px_10px_rgba(0,0,0,0.28)]">
            <span className="inline-flex items-center gap-1" title="В очереди">
              <Users aria-hidden className="size-3.5 text-white/70" />
              <span className="sr-only">В очереди</span>
              {room.waiting}
            </span>
            <span className="inline-flex items-center gap-1" title="Смотрят">
              <Eye aria-hidden className="size-3.5 text-white/70" />
              <span className="sr-only">Смотрят</span>
              {room.watching}
            </span>
            {!freeSeat && view.you && view.yourSeat == null ? (
              <button
                aria-pressed={queued}
                className={cn(
                  "rounded-full border border-white/15 px-2 py-0.5",
                  queued ? "bg-white/15 text-white" : "text-white/70",
                )}
                type="button"
                onClick={() => setQueued((value) => !value)}
              >
                {queued ? "Вы в очереди" : "В очередь"}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="relative w-full shrink-0" style={{ height: box.stageH }}>
        <div
          className="absolute left-1/2"
          data-table-scale={box.scale}
          style={{
            top: box.gap,
            width: box.w,
            height: box.h,
            transform: `translateX(-50%) scale(${box.scale})`,
            transformOrigin: "top center",
          }}
        >
          <div aria-hidden className="durak-floor-shadow" />
          <div className="durak-table absolute inset-0" data-felt="">
            <div aria-hidden className="durak-brand">
              <BrandMark size={150} />
            </div>
          </div>

            {view.table.length === 0 && view.phase !== "play" ? (
              <div className="absolute left-1/2 top-1/2 z-[3] h-16 w-28 -translate-x-1/2 -translate-y-1/2">
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
              <div className="absolute left-1/2 top-[56%] z-[3] flex max-w-[72%] -translate-x-1/2 -translate-y-1/2 flex-wrap items-center justify-center gap-1.5">
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

            <div className="absolute left-1/2 top-[13%] z-[2] -translate-x-1/2 -translate-y-1/2">
              <span className="relative block h-[3.4rem] w-24">
                {view.trumpSuit ? (
                  <span
                    className={cn(
                      "absolute left-11 top-0.5 flex h-[3.3rem] w-[2.35rem] rotate-[12deg] items-center justify-center rounded-md border border-slate-200 bg-white text-xl font-semibold shadow-[0_8px_12px_rgba(0,0,0,0.32)]",
                      suitTone(view.trumpSuit),
                    )}
                  >
                    {suitLabel(view.trumpSuit)}
                  </span>
                ) : null}
                <span className="absolute left-1 top-0.5">
                  <CardBack size="deck" />
                </span>
                <span className="absolute left-0 top-0">
                  <CardBack size="deck" />
                </span>
                {view.stockCount > 0 ? (
                  <span className="absolute left-5 -top-2 z-10 flex size-4 items-center justify-center rounded-full bg-[#f3e2b3] text-[9px] font-semibold text-[#3a2414]">
                    {view.stockCount}
                  </span>
                ) : null}
              </span>
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
            {flight.card ? <FeltCard card={flight.card} /> : <CardBack />}
          </span>
        ))}

        {view.seats.map((seat) => {
          const slot = visualSlot(seat.index, view.yourSeat);
          const point = seatCenter(slot, box.w, box.h);
          const outward = point.x < box.w / 2 - 8 ? -1 : point.x > box.w / 2 + 8 ? 1 : 0;
          const mark: SeatVoice | "muted" | null = !seat.occupied || seat.isBot
            ? null
            : seat.isYou
              ? voice.micOn
                ? voice.selfSpeaking
                  ? "speaking"
                  : "on"
                : "muted"
              : seat.userId
                ? (voice.voices[seat.userId] ?? null)
                : null;
          const bottomCovered = view.yourCards.length === 0 && slot === 0 && seat.occupied && seat.cardCount > 0;
          const peek = seat.occupied && !seat.isYou && seat.cardCount > 0 && view.phase !== "waiting" && !bottomCovered;
          return (
          <Fragment key={seat.index}>
          {peek ? (
            <span
              aria-hidden
              className="pointer-events-none absolute z-10 flex"
              style={{
                left: point.x - outward * 40,
                top: point.y - 4,
                transform: "translate(-50%, -50%)",
              }}
            >
              {Array.from({ length: Math.min(Math.max(seat.cardCount, 1), 3) }, (_, layer) => (
                <span
                  key={layer}
                  className="relative"
                  style={{
                    marginLeft: layer === 0 ? 0 : -16,
                    transform: `rotate(${(layer - 1) * (outward || 1) * 14}deg)`,
                    zIndex: layer,
                  }}
                >
                  <CardBack size="peek" />
                </span>
              ))}
            </span>
          ) : null}
          <button
            className="absolute z-40 flex w-16 flex-col items-center active:scale-95"
            data-seat={slot}
            style={{ left: point.x, top: point.y, transform: "translate(-50%, -28px)" }}
            type="button"
            onClick={() => occupy(seat.index, seat.occupied)}
          >
            <span className="relative flex flex-col items-center">
              <SeatFace seat={seat} speaking={mark === "speaking"} />
              {mark ? (
                <span
                  className={cn(
                    "absolute -right-0.5 top-0 z-20 flex size-4 items-center justify-center rounded-full text-white shadow-sm",
                    mark === "speaking"
                      ? "bg-brand-green"
                      : mark === "on"
                        ? "bg-brand-blue"
                        : "bg-black/70",
                  )}
                >
                  {mark === "muted" ? (
                    <MicOff aria-hidden className="size-2.5" />
                  ) : (
                    <Mic aria-hidden className="size-2.5" />
                  )}
                </span>
              ) : null}
              <span
                className={cn(
                  "mt-1 max-w-16 truncate rounded-full border px-1.5 py-0.5 text-[10px] leading-none shadow-sm",
                  seat.occupied
                    ? "border-white/10 bg-black/70 text-white"
                    : "border-white/20 bg-white/10 text-white/80 backdrop-blur-[2px]",
                )}
              >
                {seat.occupied ? seat.name : "Занять"}
              </span>
              {seat.occupied && view.phase !== "waiting" ? (
                <span className="mt-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#f3e2b3] px-1 text-[9px] font-semibold leading-none text-[#3a2414]">
                  {seat.cardCount}
                </span>
              ) : null}
            </span>
          </button>
          </Fragment>
          );
        })}

        {view.yourCards.length > 0 || hiddenFan > 0 ? (
        <HandFan
          boxWidth={box.w}
          cards={view.yourCards}
          handDrag={handDrag}
          hiddenFan={hiddenFan}
          pending={pending}
          picked={picked}
          playable={playable}
          stamp={handStamp}
          fresh={freshCards}
          onChoose={choose}
        />
      ) : null}
        </div>

      {view.notice ? (
        <p className="absolute inset-x-3 bottom-36 z-40 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-center text-xs text-white shadow-sm">{view.notice}</p>
      ) : null}
      {message || voice.message ? (
        <p className="absolute inset-x-3 bottom-36 z-40 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-center text-xs text-white shadow-sm">{message ?? voice.message}</p>
      ) : null}

      {view.canTake || view.canPass || view.canRedeal || view.canVoteMode || view.canVoteBot ? (
        <div className="absolute inset-x-2 bottom-[9.5rem] z-40 flex flex-wrap justify-center gap-2">
          {view.canTake ? (
            <Button className="min-h-11 rounded-full shadow-sm" disabled={pending} onClick={() => run(() => takeDurakAction(tableId))}>
              Беру
            </Button>
          ) : null}
          {view.canPass ? (
            <Button className="min-h-11 rounded-full" disabled={pending} variant="secondary" onClick={() => run(() => passDurakAction(tableId))}>
              Бито
            </Button>
          ) : null}
          {view.canRedeal ? (
            <Button className="min-h-11 rounded-full" disabled={pending} variant="secondary" onClick={() => run(() => redealDurakAction(tableId))}>
              Сдать заново
            </Button>
          ) : null}
          {view.canVoteMode ? (
            <>
              <Button className="min-h-11 rounded-full" disabled={pending} variant="secondary" onClick={() => run(() => voteDurakModeAction(tableId, "podkidnoy"))}>
                Подкидной
              </Button>
              <Button className="min-h-11 rounded-full" disabled={pending} variant="secondary" onClick={() => run(() => voteDurakModeAction(tableId, "perevodnoy"))}>
                Переводной
              </Button>
            </>
          ) : null}
          {view.canVoteBot ? (
            <>
              <Button className="min-h-11 rounded-full" disabled={pending} variant="secondary" onClick={() => run(() => voteDurakBotAction(tableId, "keep"))}>
                Оставить бота
              </Button>
              <Button className="min-h-11 rounded-full" disabled={pending} onClick={() => run(() => voteDurakBotAction(tableId, "drop"))}>
                Убрать бота
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      </div>

      <DurakChat
        avatarUrl={youSeat?.avatarUrl ?? null}
        name={view.you?.name ?? "Гость"}
        side={
          <>
            <button
              aria-label={voice.micOn ? "Выключить микрофон" : "Включить микрофон"}
              aria-pressed={voice.micOn}
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/55 shadow-[0_4px_10px_rgba(0,0,0,0.35)]",
                voice.micOn ? "border-brand-blue bg-brand-blue text-white" : "",
              )}
              disabled={voice.busy}
              type="button"
              onClick={voice.toggleMic}
            >
              {voice.micOn ? <Mic aria-hidden className="size-5" /> : <MicOff aria-hidden className="size-5" />}
            </button>
            <button
              aria-label={voice.hearing ? "Не слышать стол" : "Слышать стол"}
              aria-pressed={voice.hearing}
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/55 shadow-[0_4px_10px_rgba(0,0,0,0.35)]",
                voice.hearing
                  ? "border-white/30 bg-white/15 text-white"
                  : "",
              )}
              disabled={voice.busy}
              type="button"
              onClick={voice.toggleHearing}
            >
              {voice.hearing ? <Volume2 aria-hidden className="size-5" /> : <VolumeX aria-hidden className="size-5" />}
            </button>
          </>
        }
      />
    </div>
  );
}
