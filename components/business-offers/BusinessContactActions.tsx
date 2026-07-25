import { Phone, Globe, MessageCircle } from "lucide-react";

type BusinessContactActionsProps = {
  phone?: string | null;
  website?: string | null;
  compact?: boolean;
};

export function BusinessContactActions({
  phone,
  website,
  compact = false,
}: BusinessContactActionsProps) {
  if (!phone && !website) return null;

  return (
    <div
      className={
        compact
          ? "flex flex-wrap gap-2"
          : "flex flex-col gap-2 sm:flex-row sm:flex-wrap"
      }
    >
      {phone && (
        <a
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          href={`tel:${phone}`}
        >
          <Phone aria-hidden="true" className="size-4" />
          Позвонить
        </a>
      )}
      {website && (
        <a
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
          href={website}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Globe aria-hidden="true" className="size-4" />
          Сайт
        </a>
      )}
      {phone && (
        <a
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50 sm:hidden"
          href={`sms:${phone}`}
        >
          <MessageCircle aria-hidden="true" className="size-4" />
          Написать
        </a>
      )}
    </div>
  );
}
