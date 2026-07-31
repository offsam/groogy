import type { Metadata } from "next";
import { AdminCatalogHealthPanel } from "@/components/admin/AdminCatalogHealthPanel";

export const metadata: Metadata = {
  title: "Health — System — Admin",
};

export default function Page() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          System · Health
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Нагрузка каталога: TTL кэша агрегатов главной, exact counts и live
          latency probes (без Next cache). После массовых публикаций сбрасывай
          кэш, чтобы цифры на главной обновились сразу.
        </p>
      </div>
      <AdminCatalogHealthPanel />
    </div>
  );
}
