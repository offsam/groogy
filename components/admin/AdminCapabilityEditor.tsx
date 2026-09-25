"use client";

import { useState, useTransition } from "react";
import {
  ADMIN_CAPABILITIES,
  ALL_ADMIN_CAPABILITIES,
  type AdminCapabilityId,
} from "@/lib/admin/capabilities";
import { saveAdminCapabilitiesAction } from "@/lib/admin/capability-actions";

export type CapabilityAdmin = {
  id: string;
  name: string;
  email: string | null;
  capabilities: AdminCapabilityId[];
};

export function AdminCapabilityEditor({
  admins,
  grantsReady,
}: {
  admins: CapabilityAdmin[];
  grantsReady: boolean;
}) {
  if (admins.length === 0) {
    return (
      <p className="text-sm text-slate-500">Администраторов пока нет.</p>
    );
  }

  return (
    <section className="space-y-3" id="admins">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Администраторы</h2>
        <p className="mt-1 text-sm text-slate-500">
          Галочки задают, какими разделами человек сможет пользоваться. Пока
          разделы ещё не закрываются по ним: выбор только сохраняется.
        </p>
      </div>
      {!grantsReady ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          Таблица прав ещё не создана в базе, поэтому сохранить пока нельзя.
        </p>
      ) : null}
      <ul className="space-y-3">
        {admins.map((admin) => (
          <li key={admin.id}>
            <CapabilityCard admin={admin} disabled={!grantsReady} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CapabilityCard({
  admin,
  disabled,
}: {
  admin: CapabilityAdmin;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<AdminCapabilityId[]>(
    admin.capabilities,
  );
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function toggle(id: AdminCapabilityId) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    setNote(null);
  }

  function save() {
    setNote(null);
    startTransition(async () => {
      const result = await saveAdminCapabilitiesAction({
        userId: admin.id,
        capabilities: selected,
      });
      setNote(result.ok ? "Сохранено" : result.message);
    });
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <p className="font-medium text-slate-900">{admin.name}</p>
      {admin.email ? (
        <p className="text-sm text-slate-500">{admin.email}</p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {ADMIN_CAPABILITIES.map((item) => {
          const on = selected.includes(item.id);
          return (
            <li key={item.id}>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input
                  checked={on}
                  className="mt-1 size-4"
                  disabled={disabled || pending}
                  onChange={() => toggle(item.id)}
                  type="checkbox"
                />
                <span>
                  <span className="font-medium text-slate-900">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {item.hint}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          className="min-h-11 rounded-xl bg-brand-blue px-4 text-sm font-semibold text-white disabled:opacity-60"
          disabled={disabled || pending || selected.length === 0}
          onClick={save}
          type="button"
        >
          {pending ? "Сохраняем…" : "Сохранить"}
        </button>
        {selected.length !== ALL_ADMIN_CAPABILITIES.length ? (
          <span className="text-xs text-slate-500">
            Включено разделов: {selected.length}
          </span>
        ) : null}
        {note ? <span className="text-sm text-slate-600">{note}</span> : null}
      </div>
    </article>
  );
}
