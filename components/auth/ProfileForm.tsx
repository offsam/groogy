"use client";

import { useActionState } from "react";

import {
  updateDisplayNameAction,
  type ActionResult,
} from "@/lib/auth/actions";
import { AuthAlert, AuthField } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { BrandPinLoader } from "@/components/brand/BrandPinLoader";

const initialState: ActionResult | null = null;

type ProfileFormProps = {
  displayName: string;
};

export function ProfileForm({ displayName }: ProfileFormProps) {
  const [state, formAction, pending] = useActionState(updateDisplayNameAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok && <AuthAlert>{state.message}</AuthAlert>}
      {state?.ok && state.message && (
        <AuthAlert tone="success">{state.message}</AuthAlert>
      )}

      <AuthField
        autoComplete="name"
        defaultValue={displayName}
        id="display_name"
        label="Отображаемое имя"
        name="display_name"
        required
        type="text"
      />

      <Button
        className="gap-2 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending && <BrandPinLoader size="sm" />}
        Сохранить
      </Button>
    </form>
  );
}
