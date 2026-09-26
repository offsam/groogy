"use client";

import { Send, Smile, User } from "lucide-react";
import { useState, type ReactNode } from "react";

const EMOJI = ["👍", "😀", "🔥", "👏", "❤️"];

export type TableNote = {
  id: string;
  name: string;
  avatarUrl: string | null;
  at: string;
  text: string;
};

export function DurakChat({
  name,
  avatarUrl,
  side,
}: {
  name: string;
  avatarUrl: string | null;
  side?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const [emoji, setEmoji] = useState(false);
  const [notes, setNotes] = useState<TableNote[]>([]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    const note: TableNote = {
      id: crypto.randomUUID(),
      name,
      avatarUrl,
      at: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
      text,
    };
    setNotes((current) => [...current, note]);
    setDraft("");
    setEmoji(false);
  }

  return (
        <div className="flex min-h-0 flex-1 flex-col border-t border-white/10 bg-[#10151b]/95 pb-[env(safe-area-inset-bottom)]">
      <div className="flex shrink-0 items-center gap-1 px-2 pt-1">
        <p className="min-w-0 flex-1 px-1 text-sm font-semibold text-white">Чат</p>
        {side}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {notes.length === 0 ? (
          <p className="px-1 py-0.5 text-xs text-white/40">Пока нет сообщений.</p>
        ) : (
          notes.map((note) => (
            <div className="flex items-start gap-1.5 py-0.5" key={note.id}>
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-white/70">
                {note.avatarUrl ? (
                  <img alt="" className="size-full object-cover" src={note.avatarUrl} />
                ) : (
                  <User aria-hidden className="size-3" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-xs leading-tight text-white">
                  <span className="font-semibold">{note.name}</span>
                  <span className="text-[10px] font-normal text-white/40"> · {note.at}</span>
                </p>
                <p className="text-xs leading-snug text-white/80">{note.text}</p>
              </div>
            </div>
          ))
        )}
      </div>
      {emoji ? (
        <div className="flex shrink-0 gap-1 px-2 pb-0.5">
          {EMOJI.map((item) => (
            <button
              className="flex h-9 min-w-9 items-center justify-center rounded-full text-lg text-white hover:bg-white/10"
              key={item}
              type="button"
              onClick={() => setDraft((value) => `${value}${item}`)}
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="flex shrink-0 items-center gap-1 px-2 py-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <button
          aria-label="Эмодзи"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/30 text-white/70"
          type="button"
          onClick={() => setEmoji((value) => !value)}
        >
          <Smile aria-hidden className="size-5" />
        </button>
        <input
          className="min-h-10 min-w-0 flex-1 rounded-full border border-white/10 bg-white/10 px-3 text-sm text-white outline-none placeholder:text-white/35"
          placeholder="Напишите сообщение..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          aria-label="Отправить"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white shadow-[0_4px_10px_rgba(0,0,0,0.35)] disabled:opacity-40"
          disabled={!draft.trim()}
          type="submit"
        >
          <Send aria-hidden className="size-4" />
        </button>
      </form>
    </div>
  );
}
