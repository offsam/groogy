"use client";

import {
  FacebookIcon,
  InstagramIcon,
  TelegramIcon,
  WhatsAppIcon,
} from "@/components/brand/BrandIcons";
import { cn } from "@/lib/utils";
import type { DisplayContact } from "@/lib/import-review/contacts";
import { Globe, Mail, Phone } from "lucide-react";

function IconForKind({ kind }: { kind: DisplayContact["kind"] }) {
  const cls = "size-3.5 shrink-0";
  switch (kind) {
    case "phone":
      return <Phone aria-hidden className={cls} />;
    case "whatsapp":
      return <WhatsAppIcon className={cn(cls, "text-[#25D366]")} />;
    case "telegram":
    case "telegram_no_username":
      return <TelegramIcon className={cn(cls, "text-[#229ED9]")} />;
    case "email":
      return <Mail aria-hidden className={cls} />;
    case "website":
    case "source":
      return <Globe aria-hidden className={cls} />;
    case "instagram":
      return <InstagramIcon className={cn(cls, "text-[#E4405F]")} />;
    case "facebook":
      return <FacebookIcon className={cn(cls, "text-[#1877F2]")} />;
    default:
      return null;
  }
}

const KIND_TITLE: Record<DisplayContact["kind"], string> = {
  phone: "Телефон",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  telegram_no_username: "Telegram (без username)",
  email: "Email",
  website: "Сайт",
  instagram: "Instagram",
  facebook: "Facebook",
  source: "Источник",
};

type Props = {
  contacts: DisplayContact[];
  className?: string;
  /** Show text labels next to icons (queue footer). */
  showLabels?: boolean;
  max?: number;
};

export function ImportReviewContactIcons({
  contacts,
  className,
  showLabels = false,
  max = 8,
}: Props) {
  if (contacts.length === 0) {
    return (
      <span className={cn("text-[11px] text-slate-400", className)}>
        нет контактов
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-1.5",
        className,
      )}
    >
      {contacts.slice(0, max).map((c) => {
        const title = `${KIND_TITLE[c.kind]}: ${c.label}`;
        const inner = (
          <>
            <IconForKind kind={c.kind} />
            {showLabels ? (
              <span className="max-w-[9rem] truncate text-[11px]">{c.label}</span>
            ) : null}
          </>
        );
        const chipClass = cn(
          "inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-slate-700",
          !showLabels && "size-7 justify-center px-0",
        );
        if (c.href) {
          return (
            <a
              key={`${c.kind}-${c.label}`}
              href={c.href}
              target="_blank"
              rel="noreferrer"
              title={title}
              className={cn(chipClass, "hover:border-slate-400")}
              onClick={(e) => e.stopPropagation()}
            >
              {inner}
            </a>
          );
        }
        return (
          <span
            key={`${c.kind}-${c.label}`}
            title={title}
            className={chipClass}
          >
            {inner}
          </span>
        );
      })}
    </span>
  );
}
