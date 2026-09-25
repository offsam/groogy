"use client";

import { Send, Smile } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [emoji, setEmoji] = useState(false);
  const [notes, setNotes] = useState<TableNote[]>([]);
  const [unread, setUnread] = useState(0);

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
    if (!open) setUnread((count) => count + 1);
  }

  return (
    <>
      <div className="flex items-center border-t border-slate-200 bg-white pr-1 pb-[env(safe-area-inset-bottom)]">
        <button
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm font-semibold text-slate-900"
          type="button"
          onClick={() => {
            setOpen((value) => !value);
            setUnread(0);
          }}
        >
          <span>Чат</span>
          {unread > 0 ? (
            <span className="flex min-w-5 items-center justify-center rounded-full bg-brand-red px-1.5 text-[11px] font-semibold text-white">
              {unread}
            </span>
          ) : null}
        </button>
        {side}
      </div>
      {open ? (
        <div className="absolute inset-x-0 bottom-0 z-40 flex max-h-[62%] flex-col rounded-t-3xl border border-slate-200 bg-white shadow-[0_-12px_30px_rgba(15,23,42,0.16)]">
          <button
            className="flex min-h-11 shrink-0 items-center px-3 text-sm font-semibold text-slate-900"
            type="button"
            onClick={() => setOpen(false)}
          >
            Чат
          </button>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-2">
            {notes.length === 0 ? (
              <p className="text-sm text-slate-500">Пока нет сообщений.</p>
            ) : (
              notes.map((note) => (
                <div className="flex items-start gap-2" key={note.id}>
                  <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                    {note.avatarUrl ? (
                      <img alt="" className="size-full object-cover" src={note.avatarUrl} />
                    ) : (
                      note.name.slice(0, 1)
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm leading-tight text-slate-900">
                      <span className="font-semibold">{note.name}</span>{" "}
                      <span className="text-[11px] font-normal text-slate-400">{note.at}</span>
                    </p>
                    <p className="text-sm leading-snug text-slate-800">{note.text}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          {emoji ? (
            <div className="flex gap-1 px-3 pb-1">
              {EMOJI.map((item) => (
                <button
                  className="flex size-11 items-center justify-center rounded-full text-xl hover:bg-slate-100"
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
            className="flex items-center gap-1 border-t border-slate-100 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <button
              aria-label="Эмодзи"
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-slate-500"
              type="button"
              onClick={() => setEmoji((value) => !value)}
            >
              <Smile aria-hidden className="size-5" />
            </button>
            <input
              className="min-h-11 min-w-0 flex-1 rounded-full bg-slate-100 px-3 text-sm text-slate-900 outline-none"
              placeholder="Напишите сообщение..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              aria-label="Отправить"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-blue text-white disabled:opacity-40"
              disabled={!draft.trim()}
              type="submit"
            >
              <Send aria-hidden className="size-4" />
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
