"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { patchBusinessProfileAction } from "@/lib/business/owner-actions";
import { composeBusinessDescription } from "@/lib/content/structure-business-profile";
import type { OpeningHours, OpeningHoursDay } from "@/lib/business/opening-hours";
import {
  dayLabelRu,
  openingHoursRows,
} from "@/lib/business/opening-hours";
import { SectionEditDialog } from "@/components/business/profile/edit/SectionEditDialog";

type BaseProps = {
  businessId: string;
  businessSlug: string;
  open: boolean;
  onClose: () => void;
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-blue";

export function EditHoursDialog({
  businessId,
  businessSlug,
  open,
  onClose,
  hours,
}: BaseProps & { hours: OpeningHours | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<OpeningHoursDay[]>(() =>
    openingHoursRows(
      hours ?? {
        timezone: "America/Los_Angeles",
        weekly: [],
      },
    ),
  );

  function updateDay(day: OpeningHoursDay["day"], patch: Partial<OpeningHoursDay>) {
    setRows((prev) =>
      prev.map((r) => (r.day === day ? { ...r, ...patch } : r)),
    );
  }

  return (
    <SectionEditDialog
      error={error}
      open={open}
      pending={pending}
      title="Часы работы"
      onClose={onClose}
      onSave={() => {
        setError(null);
        startTransition(async () => {
          const result = await patchBusinessProfileAction({
            businessId,
            businessSlug,
            patch: {
              openingHours: {
                timezone: hours?.timezone ?? "America/Los_Angeles",
                weekly: rows,
              },
            },
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onClose();
          router.refresh();
        });
      }}
    >
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.day} className="space-y-1.5 rounded-xl border border-slate-100 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-800">
                {dayLabelRu(row.day)}
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  checked={Boolean(row.closed)}
                  type="checkbox"
                  onChange={(e) =>
                    updateDay(row.day, {
                      closed: e.target.checked,
                      open: e.target.checked ? null : row.open || "10:00",
                      close: e.target.checked ? null : row.close || "19:00",
                    })
                  }
                />
                Закрыто
              </label>
            </div>
            {!row.closed ? (
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputClass}
                  type="time"
                  value={row.open ?? "10:00"}
                  onChange={(e) => updateDay(row.day, { open: e.target.value })}
                />
                <input
                  className={inputClass}
                  type="time"
                  value={row.close ?? "19:00"}
                  onChange={(e) => updateDay(row.day, { close: e.target.value })}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </SectionEditDialog>
  );
}

export function EditAddressDialog({
  businessId,
  businessSlug,
  open,
  onClose,
  addressLine,
  city,
  region,
}: BaseProps & {
  addressLine: string | null;
  city: string | null;
  region: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState(addressLine ?? "");
  const [cityVal, setCityVal] = useState(city ?? "");
  const [regionVal, setRegionVal] = useState(region ?? "");

  return (
    <SectionEditDialog
      error={error}
      open={open}
      pending={pending}
      title="Адрес"
      onClose={onClose}
      onSave={() => {
        setError(null);
        startTransition(async () => {
          const result = await patchBusinessProfileAction({
            businessId,
            businessSlug,
            patch: {
              addressLine: line,
              city: cityVal,
              region: regionVal,
            },
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onClose();
          router.refresh();
        });
      }}
    >
      <div className="space-y-3">
        <Field label="Улица">
          <input className={inputClass} value={line} onChange={(e) => setLine(e.target.value)} />
        </Field>
        <Field label="Город">
          <input
            className={inputClass}
            value={cityVal}
            onChange={(e) => setCityVal(e.target.value)}
          />
        </Field>
        <Field label="Регион / ZIP">
          <input
            className={inputClass}
            value={regionVal}
            onChange={(e) => setRegionVal(e.target.value)}
          />
        </Field>
      </div>
    </SectionEditDialog>
  );
}

export function EditContactsDialog({
  businessId,
  businessSlug,
  open,
  onClose,
  phone,
  email,
  website,
  instagramUrl,
  yelpUrl,
  googleMapsUrl,
}: BaseProps & {
  phone: string | null;
  email: string | null;
  website: string | null;
  instagramUrl: string | null;
  yelpUrl: string | null;
  googleMapsUrl: string | null;
  facebookUrl?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [phoneVal, setPhoneVal] = useState(phone ?? "");
  const [emailVal, setEmailVal] = useState(email ?? "");
  const [websiteVal, setWebsiteVal] = useState(website ?? "");
  const [igVal, setIgVal] = useState(instagramUrl ?? "");
  const [yelpVal, setYelpVal] = useState(yelpUrl ?? "");
  const [mapsVal, setMapsVal] = useState(googleMapsUrl ?? "");

  return (
    <SectionEditDialog
      error={error}
      open={open}
      pending={pending}
      title="Контакты"
      onClose={onClose}
      onSave={() => {
        setError(null);
        startTransition(async () => {
          const result = await patchBusinessProfileAction({
            businessId,
            businessSlug,
            patch: {
              phone: phoneVal,
              email: emailVal,
              website: websiteVal,
              instagramUrl: igVal,
              yelpUrl: yelpVal,
              googleMapsUrl: mapsVal,
            },
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onClose();
          router.refresh();
        });
      }}
    >
      <div className="space-y-3">
        <Field label="Телефон">
          <input className={inputClass} value={phoneVal} onChange={(e) => setPhoneVal(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" value={emailVal} onChange={(e) => setEmailVal(e.target.value)} />
        </Field>
        <Field label="Сайт">
          <input className={inputClass} value={websiteVal} onChange={(e) => setWebsiteVal(e.target.value)} />
        </Field>
        <Field label="Instagram URL">
          <input className={inputClass} value={igVal} onChange={(e) => setIgVal(e.target.value)} />
        </Field>
        <Field label="Yelp URL">
          <input className={inputClass} value={yelpVal} onChange={(e) => setYelpVal(e.target.value)} />
        </Field>
        <Field label="Google Maps URL">
          <input className={inputClass} value={mapsVal} onChange={(e) => setMapsVal(e.target.value)} />
        </Field>
      </div>
    </SectionEditDialog>
  );
}

export function EditCopyDialog({
  businessId,
  businessSlug,
  open,
  onClose,
  mode,
  about,
  jobs,
  promotions,
  shortDescription,
}: BaseProps & {
  mode: "about" | "jobs" | "promotions";
  about: string;
  jobs: string;
  promotions: string;
  shortDescription: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [aboutVal, setAboutVal] = useState(about);
  const [jobsVal, setJobsVal] = useState(jobs);
  const [promosVal, setPromosVal] = useState(promotions);
  const [shortVal, setShortVal] = useState(shortDescription);

  const title =
    mode === "about" ? "О компании" : mode === "jobs" ? "Вакансии" : "Акции";

  return (
    <SectionEditDialog
      error={error}
      open={open}
      pending={pending}
      title={title}
      onClose={onClose}
      onSave={() => {
        setError(null);
        startTransition(async () => {
          const description = composeBusinessDescription({
            about: mode === "about" ? aboutVal : about,
            jobs: mode === "jobs" ? jobsVal : jobs,
            promotions: mode === "promotions" ? promosVal : promotions,
          });
          const result = await patchBusinessProfileAction({
            businessId,
            businessSlug,
            patch: {
              description,
              shortDescription: mode === "about" ? shortVal : shortDescription,
            },
          });
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onClose();
          router.refresh();
        });
      }}
    >
      {mode === "about" ? (
        <div className="space-y-3">
          <Field label="Кратко">
            <textarea
              className={`${inputClass} min-h-[4rem]`}
              value={shortVal}
              onChange={(e) => setShortVal(e.target.value)}
            />
          </Field>
          <Field label="Полное описание">
            <textarea
              className={`${inputClass} min-h-[10rem]`}
              value={aboutVal}
              onChange={(e) => setAboutVal(e.target.value)}
            />
          </Field>
        </div>
      ) : null}
      {mode === "jobs" ? (
        <Field label="Текст вакансии">
          <textarea
            className={`${inputClass} min-h-[12rem]`}
            value={jobsVal}
            onChange={(e) => setJobsVal(e.target.value)}
          />
        </Field>
      ) : null}
      {mode === "promotions" ? (
        <Field label="Текст акции">
          <textarea
            className={`${inputClass} min-h-[8rem]`}
            value={promosVal}
            onChange={(e) => setPromosVal(e.target.value)}
          />
        </Field>
      ) : null}
    </SectionEditDialog>
  );
}
