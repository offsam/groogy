"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Shield, ShieldOff } from "lucide-react";
import { adminSetUserRoleAction } from "@/lib/admin/actions";
import type { AdminUserRow } from "@/lib/admin/queries";
import { AuthAlert } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

const ROLE_LABELS: Record<AdminUserRow["role"], string> = {
  user: "Пользователь",
  business_owner: "Владелец бизнеса",
  moderator: "Модератор",
  admin: "Админ",
};

type AdminUsersPanelProps = {
  users: AdminUserRow[];
  currentUserId: string;
};

export function AdminUsersPanel({ users, currentUserId }: AdminUsersPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function setRole(userId: string, role: AdminUserRow["role"]) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await adminSetUserRoleAction({ userId, role });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(result.message ?? "Готово");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
      {message ? <AuthAlert tone="success">{message}</AuthAlert> : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Пользователь</th>
              <th className="px-4 py-3 font-medium">Роль</th>
              <th className="px-4 py-3 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              return (
                <tr key={user.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">
                      {user.display_name || "Без имени"}
                      {isSelf ? (
                        <span className="ml-2 text-xs text-brand-blue">(вы)</span>
                      ) : null}
                    </p>
                    <p className="text-slate-500">{user.email ?? user.id}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                      {ROLE_LABELS[user.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {user.role !== "admin" ? (
                        <Button
                          className="gap-1.5"
                          disabled={pending}
                          onClick={() => setRole(user.id, "admin")}
                          type="button"
                          variant="primary"
                        >
                          {pending ? (
                            <BrandPinLoader size="sm" />
                          ) : (
                            <Shield className="size-4" />
                          )}
                          Сделать админом
                        </Button>
                      ) : (
                        <Button
                          className="gap-1.5"
                          disabled={pending || isSelf}
                          onClick={() => setRole(user.id, "user")}
                          type="button"
                          variant="secondary"
                        >
                          {pending ? (
                            <BrandPinLoader size="sm" />
                          ) : (
                            <ShieldOff className="size-4" />
                          )}
                          Снять админа
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
