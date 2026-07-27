"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { JobCard } from "@/components/jobs/JobCard";
import { createBusinessJobAction } from "@/lib/jobs/actions";
import type { Job } from "@/types/job";

type BusinessJobsPanelProps = {
  businessId: string;
  businessSlug: string;
  city?: string | null;
  jobs: Job[];
  canEdit: boolean;
};

export function BusinessJobsPanel({
  businessId,
  businessSlug,
  city,
  jobs,
  canEdit,
}: BusinessJobsPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [nationwide, setNationwide] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createBusinessJobAction({
        businessId,
        businessSlug,
        title,
        description,
        city: city ?? undefined,
        nationwide,
        publish: true,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTitle("");
      setDescription("");
      setNationwide(false);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {jobs.length === 0 ? (
        <p className="text-sm text-slate-500">Вакансий пока нет</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}

      {canEdit ? (
        open ? (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-brand-blue/30 focus:ring-2"
              placeholder="Название вакансии"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-brand-blue/30 focus:ring-2"
              placeholder="Описание"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                checked={nationwide}
                className="mt-1"
                type="checkbox"
                onChange={(e) => setNationwide(e.target.checked)}
              />
              <span>
                По всей стране
                <span className="block text-xs text-slate-500">
                  Без привязки к региону (например, дальнобой) — видно во всех
                  хабах
                </span>
              </span>
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-lg bg-brand-blue px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={pending}
                type="button"
                onClick={submit}
              >
                {pending ? "Публикация…" : "Опубликовать"}
              </button>
              <button
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                disabled={pending}
                type="button"
                onClick={() => setOpen(false)}
              >
                Отмена
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Вакансия появится на этой странице и в разделе «Работа».
            </p>
          </div>
        ) : (
          <button
            className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:border-brand-blue/40 hover:text-brand-blue"
            type="button"
            onClick={() => setOpen(true)}
          >
            + Добавить вакансию
          </button>
        )
      ) : null}
    </div>
  );
}
