"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import {
  createBloggerAction,
  deleteBloggerAction,
  updateBloggerAction,
  type BloggerDirectoryInput,
  type BloggerDirectoryRow,
} from "@/lib/admin/blogger-directory";
import { Button } from "@/components/ui/Button";
import { AuthAlert } from "@/components/auth/AuthShell";
import { cn } from "@/lib/utils";

type Props = {
  bloggers: BloggerDirectoryRow[];
};

type FormState = {
  name: string;
  category: string;
  location: string;
  notes: string;
  facebookUrl: string;
  instagramUrl: string;
  youtubeUrl: string;
  tiktokUrl: string;
  telegramUrl: string;
  source: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  category: "",
  location: "",
  notes: "",
  facebookUrl: "",
  instagramUrl: "",
  youtubeUrl: "",
  tiktokUrl: "",
  telegramUrl: "",
  source: "",
};

const PLATFORM_FIELDS: Array<{
  key: keyof Pick<
    FormState,
    "facebookUrl" | "instagramUrl" | "youtubeUrl" | "tiktokUrl" | "telegramUrl"
  >;
  label: string;
}> = [
  { key: "facebookUrl", label: "Facebook" },
  { key: "instagramUrl", label: "Instagram" },
  { key: "youtubeUrl", label: "YouTube" },
  { key: "tiktokUrl", label: "TikTok" },
  { key: "telegramUrl", label: "Telegram" },
];

function toInput(form: FormState): BloggerDirectoryInput {
  return {
    name: form.name,
    category: form.category,
    location: form.location || null,
    notes: form.notes || null,
    facebookUrl: form.facebookUrl || null,
    instagramUrl: form.instagramUrl || null,
    youtubeUrl: form.youtubeUrl || null,
    tiktokUrl: form.tiktokUrl || null,
    telegramUrl: form.telegramUrl || null,
    source: form.source || null,
  };
}

function rowToForm(row: BloggerDirectoryRow): FormState {
  return {
    name: row.name,
    category: row.category,
    location: row.location ?? "",
    notes: row.notes ?? "",
    facebookUrl: row.facebookUrl ?? "",
    instagramUrl: row.instagramUrl ?? "",
    youtubeUrl: row.youtubeUrl ?? "",
    tiktokUrl: row.tiktokUrl ?? "",
    telegramUrl: row.telegramUrl ?? "",
    source: row.source ?? "",
  };
}

function FieldGrid({
  form,
  onChange,
}: {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Имя / название</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
            value={form.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Категория</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
            placeholder="путешествия, авто, бьюти…"
            value={form.category}
            onChange={(e) => onChange({ category: e.target.value })}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Локация</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
            placeholder="штат / город, если известно"
            value={form.location}
            onChange={(e) => onChange({ location: e.target.value })}
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-slate-700">Источник</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
            placeholder="как нашли — необязательно"
            value={form.source}
            onChange={(e) => onChange({ source: e.target.value })}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {PLATFORM_FIELDS.map((f) => (
          <label key={f.key} className="block space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">{f.label}</span>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
              placeholder="ссылка"
              value={form[f.key]}
              onChange={(e) => onChange({ [f.key]: e.target.value } as Partial<FormState>)}
            />
          </label>
        ))}
      </div>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium text-slate-700">Заметка</span>
        <textarea
          className="min-h-16 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </label>
    </div>
  );
}

function BloggerLinks({ row }: { row: BloggerDirectoryRow }) {
  const links: Array<{ label: string; url: string | null }> = [
    { label: "FB", url: row.facebookUrl },
    { label: "IG", url: row.instagramUrl },
    { label: "YT", url: row.youtubeUrl },
    { label: "TikTok", url: row.tiktokUrl },
    { label: "TG", url: row.telegramUrl },
  ];
  const active = links.filter((l) => l.url);
  if (active.length === 0) {
    return <p className="text-xs text-slate-400">Ссылок пока нет</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {active.map((l) => (
        <a
          key={l.label}
          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-brand-blue hover:underline"
          href={l.url ?? undefined}
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}

export function AdminBloggerDirectoryPanel({ bloggers }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? bloggers.filter((b) =>
          [b.name, b.category, b.location, b.notes]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(q)),
        )
      : bloggers;

    const byCategory = new Map<string, BloggerDirectoryRow[]>();
    for (const b of filtered) {
      const key = b.category || "разное";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(b);
    }
    return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"));
  }, [bloggers, search]);

  function submitAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await createBloggerAction(toInput(addForm));
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message ?? "Добавлено.");
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
      router.refresh();
    });
  }

  function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingId) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await updateBloggerAction({ id: editingId, ...toInput(editForm) });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message ?? "Обновлено.");
      setEditingId(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    if (!confirm("Удалить запись?")) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await deleteBloggerAction({ id });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message ?? "Удалено.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
      {message ? <AuthAlert tone="success">{message}</AuthAlert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-blue"
          placeholder="Поиск по имени, категории, заметке…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-slate-500">
          Всего: {bloggers.length}
        </span>
        <Button type="button" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Отмена" : "Добавить блогера"}
        </Button>
      </div>

      {showAddForm ? (
        <form
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4"
          onSubmit={submitAdd}
        >
          <FieldGrid form={addForm} onChange={(patch) => setAddForm((f) => ({ ...f, ...patch }))} />
          <Button disabled={pending || addForm.name.trim().length < 2} type="submit">
            {pending ? "Сохраняю…" : "Сохранить"}
          </Button>
        </form>
      ) : null}

      <div className="space-y-3">
        {grouped.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            Пока пусто.
          </p>
        ) : (
          grouped.map(([category, rows]) => {
            const isCollapsed = collapsed[category];
            return (
              <div key={category} className="rounded-2xl border border-slate-200 bg-white">
                <button
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  type="button"
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [category]: !c[category] }))
                  }
                >
                  <span className="font-semibold text-slate-900">
                    {category}{" "}
                    <span className="font-normal text-slate-400">({rows.length})</span>
                  </span>
                  {isCollapsed ? (
                    <ChevronDown className="size-4 text-slate-400" />
                  ) : (
                    <ChevronUp className="size-4 text-slate-400" />
                  )}
                </button>
                {!isCollapsed ? (
                  <ul className="divide-y divide-slate-100 border-t border-slate-100">
                    {rows.map((row) => (
                      <li key={row.id} className="p-4">
                        {editingId === row.id ? (
                          <form className="space-y-3" onSubmit={submitEdit}>
                            <FieldGrid
                              form={editForm}
                              onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))}
                            />
                            <div className="flex gap-2">
                              <Button disabled={pending} type="submit">
                                Сохранить
                              </Button>
                              <Button
                                disabled={pending}
                                type="button"
                                variant="secondary"
                                onClick={() => setEditingId(null)}
                              >
                                Отмена
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <p className="font-medium text-slate-900">
                                {row.name}
                                {row.location ? (
                                  <span className="ml-2 text-xs font-normal text-slate-400">
                                    {row.location}
                                  </span>
                                ) : null}
                              </p>
                              <BloggerLinks row={row} />
                              {row.notes ? (
                                <p className="text-sm text-slate-600">{row.notes}</p>
                              ) : null}
                              {row.source ? (
                                <p className="text-xs text-slate-400">Источник: {row.source}</p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 gap-2">
                              <button
                                aria-label="Редактировать"
                                className={cn(
                                  "rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50",
                                )}
                                type="button"
                                onClick={() => {
                                  setEditingId(row.id);
                                  setEditForm(rowToForm(row));
                                }}
                              >
                                <Pencil className="size-4" />
                              </button>
                              <button
                                aria-label="Удалить"
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                                disabled={pending}
                                type="button"
                                onClick={() => remove(row.id)}
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
