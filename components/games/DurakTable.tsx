"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
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
    left: `${50 + Math.cos(angle) * 40}%`,
    top: `${50 + Math.sin(angle) * 42}%`,
  };
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
  const [pending, startTransition] = useTransition();
  const returnPath = `/games/durak/${tableId}`;

  useEffect(() => {
    setView(initial);
  }, [initial]);

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

  const playable = view.canAttack || view.canDefend || view.canThrow;
  const modeLabel = view.mode === "podkidnoy" ? "Подкидной" : "Переводной";

  return (
    <div className="space-y-4">
      <div>
        <Link className="text-sm font-medium text-brand-blue" href="/games/durak">
          Столы
        </Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Стол {tableId}
          </h1>
          <p className="text-sm text-slate-600">
            {view.status}
            {view.nextDeckKind && view.nextDeckKind !== view.deckKind
              ? ` Следующий кон: колода ${view.nextDeckKind}.`
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

      <div className="relative mx-auto aspect-[5/4] w-full max-w-xl">
        <div className="absolute inset-x-7 inset-y-6 rounded-[2rem] bg-gradient-to-b from-[#8d5a32] via-[#5c3a1e] to-[#3a2414] p-1.5 shadow-[0_16px_30px_rgba(40,22,8,0.28)] sm:inset-x-9 sm:inset-y-7 sm:p-2">
          <div className="relative h-full overflow-hidden rounded-[1.6rem] bg-[radial-gradient(ellipse_at_50%_42%,#3eaf72_0%,#1d7c4a_46%,#0e5532_78%,#083d24_100%)] shadow-[inset_0_0_48px_rgba(0,0,0,0.45)]">
            <div
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(115deg, transparent 0 6px, rgba(255,255,255,0.035) 6px 7px)",
              }}
            />
            <div className="pointer-events-none absolute inset-2 rounded-[1.3rem] border border-[#e7c98a]/45" />

            <p className="absolute left-3 top-3 text-[11px] font-medium uppercase tracking-wide text-[#f3e2b3]">
              {modeLabel}
              {view.deckKind ? ` · ${view.deckKind}` : ""}
            </p>

            {view.table.length === 0 && view.phase !== "play" ? (
              <div className="absolute left-1/2 top-1/2 h-16 w-28 -translate-x-1/2 -translate-y-1/2">
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
              <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
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

            <div className="absolute left-[68%] top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-end">
              {view.trumpSuit ? (
                <span
                  className={cn(
                    "mb-1 mr-2 flex h-11 w-8 -rotate-90 items-center justify-center rounded-md border border-slate-200 bg-white text-lg font-semibold shadow",
                    suitTone(view.trumpSuit),
                  )}
                >
                  {suitLabel(view.trumpSuit)}
                </span>
              ) : null}
              <span className="relative h-16 w-11">
                <span className="absolute left-0.5 top-1">
                  <CardBack />
                </span>
                <span className="absolute left-0 top-0">
                  <CardBack />
                </span>
                {view.stockCount > 0 ? (
                  <span className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-[#f3e2b3] text-[10px] font-semibold text-[#3a2414]">
                    {view.stockCount}
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        </div>

        {view.seats.map((seat) => (
          <button
            className="absolute z-10 flex w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
            key={seat.index}
            style={seatPoint(seat.index, view.yourSeat)}
            type="button"
            onClick={() => occupy(seat.index, seat.occupied)}
          >
            <span
              className={cn(
                "flex size-11 items-center justify-center rounded-full border-2 text-xs font-semibold shadow-md",
                seat.isYou
                  ? "border-[#f3e2b3] bg-brand-blue text-white"
                  : seat.occupied
                    ? "border-[#f3e2b3] bg-white text-slate-800"
                    : "border-dashed border-white bg-white/90 text-brand-blue",
                seat.thinking ? "ring-2 ring-[#f3e2b3]" : "",
              )}
            >
              {seat.occupied ? (seat.isBot ? "Б" : seat.name?.slice(0, 1)) : "+"}
            </span>
            <span className="max-w-full truncate rounded-full bg-white/90 px-1.5 text-[11px] leading-tight text-slate-700">
              {seat.occupied ? seat.name : "Занять"}
              {seat.occupied && view.phase !== "waiting" ? ` · ${seat.cardCount}` : ""}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {view.canTake ? (
          <Button disabled={pending} onClick={() => run(() => takeDurakAction(tableId))}>
            Беру
          </Button>
        ) : null}
        {view.canPass ? (
          <Button
            disabled={pending}
            variant="secondary"
            onClick={() => run(() => passDurakAction(tableId))}
          >
            Бито
          </Button>
        ) : null}
        {view.canRedeal ? (
          <Button disabled={pending} onClick={() => run(() => redealDurakAction(tableId))}>
            Сдать заново
          </Button>
        ) : null}
        {view.yourSeat != null ? (
          <Button
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
            <Button
              disabled={pending}
              variant="secondary"
              onClick={() => run(() => voteDurakModeAction(tableId, "podkidnoy"))}
            >
              Подкидной
            </Button>
            <Button
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
            <Button
              disabled={pending}
              variant="secondary"
              onClick={() => run(() => voteDurakBotAction(tableId, "keep"))}
            >
              Оставить
            </Button>
            <Button disabled={pending} onClick={() => run(() => voteDurakBotAction(tableId, "drop"))}>
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
            <div className="flex items-end pl-1">
              {view.yourCards.map((card) => (
                <span className="-ml-3 first:ml-0" key={card.id}>
                  <PlayingCard
                    card={card}
                    playable={playable && !pending}
                    onPlay={(cardId) => run(() => playDurakCardAction(tableId, cardId))}
                  />
                </span>
              ))}
            </div>
          </div>
        )}
        {!view.you ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => router.push(`/login?next=${returnPath}`)}>Войти</Button>
            <Button
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
