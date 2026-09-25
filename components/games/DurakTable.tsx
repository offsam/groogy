"use client";

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

function seatPoint(index: number, yourSeat: number | null) {
  const shift = yourSeat ?? 0;
  const angle = Math.PI / 2 + ((index - shift) * 2 * Math.PI) / 7;
  return {
    left: `${50 + Math.cos(angle) * 42}%`,
    top: `${50 + Math.sin(angle) * 38}%`,
  };
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
  const red = RED_SUITS.has(card.suit);
  return (
    <button
      className={cn(
        "flex h-24 w-16 shrink-0 flex-col items-center justify-between rounded-xl border bg-white px-1.5 py-2 text-left shadow-sm sm:h-28 sm:w-[4.5rem]",
        playable
          ? "border-brand-blue hover:-translate-y-1"
          : "border-slate-200",
      )}
      disabled={!playable}
      type="button"
      onClick={() => onPlay?.(card.id)}
    >
      <span
        className={cn(
          "font-[family-name:var(--font-display)] text-lg font-semibold leading-none",
          red ? "text-brand-red" : "text-slate-900",
        )}
      >
        {rankLabel(card.rank)}
      </span>
      <span className={cn("text-xl leading-none", red ? "text-brand-red" : "text-slate-700")}>
        {suitLabel(card.suit)}
      </span>
    </button>
  );
}

export function DurakTable({ initial }: { initial: DurakView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setView(initial);
  }, [initial]);

  useEffect(() => {
    let stopped = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      void refreshDurakAction().then((next) => {
        if (!stopped) setView(next);
      });
    }, 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pending]);

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
      router.push("/login?next=/games");
      return;
    }
    run(() => sitDurakAction(index));
  }

  const playable = view.canAttack || view.canDefend || view.canThrow;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Стол №1</p>
          <p className="mt-1 text-sm text-slate-600">{view.status}</p>
        </div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {view.mode === "podkidnoy" ? "Подкидной" : "Переводной"}
          {view.deckKind ? ` · колода ${view.deckKind}` : ""}
          {view.nextDeckKind && view.nextDeckKind !== view.deckKind
            ? ` · следующий кон ${view.nextDeckKind}`
            : ""}
          {view.trumpLabel ? ` · козырь ${view.trumpLabel}` : ""}
        </p>
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

      <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-5">
        <div className="relative mx-auto aspect-square w-full max-w-xl">
          <div className="absolute left-1/2 top-1/2 flex h-[46%] w-[58%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-2 rounded-[50%] border border-slate-200 bg-slate-50 px-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {view.stockCount > 0 ? `В колоде ${view.stockCount}` : "Колода пуста"}
            </p>
            <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5">
              {view.table.length === 0 ? (
                <span className="text-xs text-slate-400">Карты кона появятся здесь</span>
              ) : (
                view.table.map((pair) => (
                  <span className="flex items-center gap-1" key={pair.attack.id}>
                    <MiniCard card={pair.attack} />
                    {pair.defense ? <MiniCard card={pair.defense} /> : null}
                  </span>
                ))
              )}
            </div>
          </div>

          {view.seats.map((seat) => (
            <button
              className="absolute flex w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 sm:w-[4.5rem]"
              key={seat.index}
              style={seatPoint(seat.index, view.yourSeat)}
              type="button"
              onClick={() => occupy(seat.index, seat.occupied)}
            >
              <span
                className={cn(
                  "flex size-11 items-center justify-center rounded-full border text-xs font-semibold sm:size-12",
                  seat.isYou
                    ? "border-brand-blue bg-brand-blue text-white"
                    : seat.occupied
                      ? "border-slate-200 bg-white text-slate-800"
                      : "border-dashed border-brand-blue/40 bg-white text-brand-blue",
                  seat.thinking ? "ring-2 ring-brand-blue/40" : "",
                )}
              >
                {seat.occupied ? (seat.isBot ? "Б" : seat.name?.slice(0, 1)) : "+"}
              </span>
              <span className="max-w-full truncate text-[11px] leading-tight text-slate-600">
                {seat.occupied ? seat.name : "Занять"}
                {seat.occupied && view.phase !== "waiting" ? ` · ${seat.cardCount}` : ""}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {view.canTake ? (
            <Button disabled={pending} onClick={() => run(() => takeDurakAction())}>
              Беру
            </Button>
          ) : null}
          {view.canPass ? (
            <Button
              disabled={pending}
              variant="secondary"
              onClick={() => run(() => passDurakAction())}
            >
              Бито
            </Button>
          ) : null}
          {view.canRedeal ? (
            <Button disabled={pending} onClick={() => run(() => redealDurakAction())}>
              Сдать заново
            </Button>
          ) : null}
          {view.yourSeat != null ? (
            <Button
              disabled={pending}
              variant="secondary"
              onClick={() => run(() => leaveDurakAction())}
            >
              Встать
            </Button>
          ) : null}
        </div>
        <DurakVoice />

        {view.canVoteMode ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-slate-700">Режим следующего кона</p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending}
                variant="secondary"
                onClick={() => run(() => voteDurakModeAction("podkidnoy"))}
              >
                Подкидной
              </Button>
              <Button
                disabled={pending}
                variant="secondary"
                onClick={() => run(() => voteDurakModeAction("perevodnoy"))}
              >
                Переводной
              </Button>
            </div>
          </div>
        ) : null}

        {view.canVoteBot ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-slate-700">Бот</p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending}
                variant="secondary"
                onClick={() => run(() => voteDurakBotAction("keep"))}
              >
                Оставить
              </Button>
              <Button
                disabled={pending}
                onClick={() => run(() => voteDurakBotAction("drop"))}
              >
                Убрать
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-slate-900">Ваши карты</h2>
        {view.yourCards.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            {view.you
              ? "Когда сядете и начнётся кон, карты будут здесь. Чужие карты не показываются."
              : "Можно смотреть стол без входа. Чтобы сесть, войдите в аккаунт."}
          </p>
        ) : (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {view.yourCards.map((card) => (
              <PlayingCard
                card={card}
                key={card.id}
                playable={playable && !pending}
                onPlay={(cardId) => run(() => playDurakCardAction(cardId))}
              />
            ))}
          </div>
        )}
        {!view.you ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => router.push("/login?next=/games")}>Войти</Button>
            <Button
              variant="secondary"
              onClick={() => router.push("/register?next=/games")}
            >
              Регистрация
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function MiniCard({ card }: { card: Card }) {
  const red = RED_SUITS.has(card.suit);
  return (
    <span
      className={cn(
        "inline-flex h-10 min-w-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-1 text-xs font-semibold",
        red ? "text-brand-red" : "text-slate-900",
      )}
    >
      {rankLabel(card.rank)}
      {suitLabel(card.suit)}
    </span>
  );
}
