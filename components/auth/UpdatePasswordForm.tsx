"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import {
  updatePasswordAction,
  type ActionResult,
} from "@/lib/auth/actions";
import { AuthAlert, AuthField } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";

const initialState: ActionResult | null = null;

export function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok && <AuthAlert>{state.message}</AuthAlert>}
      {state?.ok && state.message && (
        <AuthAlert tone="success">{state.message}</AuthAlert>
      )}

      <AuthField
        autoComplete="new-password"
        id="password"
        label="Новый пароль"
        minLength={6}
        name="password"
        required
        type="password"
      />
      <AuthField
        autoComplete="new-password"
        id="confirm_password"
        label="Повторите пароль"
        minLength={6}
        name="confirm_password"
        required
        type="password"
      />

      <Button
        className="w-full gap-2 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
        Сохранить пароль
      </Button>
    </form>
  );
}
