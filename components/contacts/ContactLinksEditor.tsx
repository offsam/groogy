"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { ContactChannelIcon } from "@/components/contacts/ContactChannelIcon";
import {
  CONTACT_CHANNEL_GROUP_LABELS,
  EXTRA_CONTACT_CHANNELS,
  getContactChannel,
  type ContactChannelGroup,
  type ContactChannelId,
  type ContactLink,
} from "@/lib/contacts/channels";

type Props = {
  value: ContactLink[];
  onChange: (next: ContactLink[]) => void;
  /** Channels that already have their own field in the surrounding form. */
  exclude?: ContactChannelId[];
  label?: string;
};

const GROUP_ORDER: ContactChannelGroup[] = [
  "messengers",
  "social",
  "platforms",
  "direct",
];

/**
 * Add any contact channel (Facebook, TikTok, WhatsApp, VK, …) to a card.
 * Channels with a dedicated DB column are edited by their own field and are
 * passed in `exclude` so the same channel is not stored twice.
 */
export function ContactLinksEditor({
  value,
  onChange,
  exclude = [],
  label = "Другие каналы связи",
}: Props) {
  const [picking, setPicking] = useState(false);

  const available = useMemo(() => {
    const used = new Set(
      value.filter((link) => link.channel !== "custom").map((l) => l.channel),
    );
    return EXTRA_CONTACT_CHANNELS.filter(
      (channel) =>
        !exclude.includes(channel.id) &&
        (channel.id === "custom" || !used.has(channel.id)),
    );
  }, [value, exclude]);

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        channels: available.filter((channel) => channel.group === group),
      })).filter((entry) => entry.channels.length > 0),
    [available],
  );

  function addChannel(id: ContactChannelId) {
    onChange([...value, { channel: id, value: "", label: null }]);
    setPicking(false);
  }

  function updateAt(index: number, patch: Partial<ContactLink>) {
    onChange(
      value.map((link, i) => (i === index ? { ...link, ...patch } : link)),
    );
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-slate-600">{label}</div>

      {value.length > 0 ? (
        <ul className="space-y-2">
          {value.map((link, index) => {
            const channel = getContactChannel(link.channel);
            if (!channel) return null;
            return (
              <li
                key={`${link.channel}-${index}`}
                className="rounded-xl border border-slate-200 bg-white p-2"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600">
                    <ContactChannelIcon channel={channel.id} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                    {channel.label}
                  </span>
                  <button
                    aria-label={`Убрать ${channel.label}`}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    type="button"
                    onClick={() => removeAt(index)}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  {channel.needsLabel ? (
                    <input
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-blue"
                      placeholder="Название ссылки"
                      value={link.label ?? ""}
                      onChange={(e) =>
                        updateAt(index, { label: e.target.value })
                      }
                    />
                  ) : null}
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-blue"
                    inputMode={channel.kind === "phone" ? "tel" : "url"}
                    placeholder={channel.placeholder}
                    value={link.value}
                    onChange={(e) => updateAt(index, { value: e.target.value })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {picking ? (
        <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
          {grouped.map((entry) => (
            <div key={entry.group}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {CONTACT_CHANNEL_GROUP_LABELS[entry.group]}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {entry.channels.map((channel) => (
                  <button
                    key={channel.id}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700 transition-colors hover:border-brand-blue hover:text-brand-blue"
                    type="button"
                    onClick={() => addChannel(channel.id)}
                  >
                    <ContactChannelIcon channel={channel.id} />
                    {channel.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            className="text-sm font-medium text-slate-500 hover:text-slate-800"
            type="button"
            onClick={() => setPicking(false)}
          >
            Отмена
          </button>
        </div>
      ) : (
        <button
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-brand-blue hover:text-brand-blue sm:min-h-0"
          type="button"
          onClick={() => setPicking(true)}
        >
          <Plus aria-hidden="true" className="size-4" />
          Добавить канал
        </button>
      )}
    </div>
  );
}
