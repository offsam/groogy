import { AlertCircle, Loader2, SearchX } from "lucide-react";

export function LoadingState({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
      <Loader2 aria-hidden="true" className="size-8 animate-spin text-slate-300" />
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

export function ErrorState({
  message = "Не удалось загрузить данные",
  detail,
}: {
  message?: string;
  detail?: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-red-200 bg-red-50 px-6 py-16 text-center">
      <AlertCircle aria-hidden="true" className="size-8 text-red-300" />
      <p className="font-medium text-slate-900">{message}</p>
      {detail && <p className="max-w-md text-sm text-slate-500">{detail}</p>}
    </div>
  );
}

export function EmptyState({
  title = "Ничего не найдено",
  description = "Попробуйте изменить запрос или сбросить фильтр категорий.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
      <SearchX aria-hidden="true" className="size-8 text-slate-300" />
      <p className="font-medium text-slate-900">{title}</p>
      <p className="text-sm text-slate-500">{description}</p>
    </div>
  );
}
