import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { AddBusinessForm } from "@/components/public/AddBusinessForm";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Добавить бизнес — ${BRAND_NAME}`,
  description:
    "Добавьте свой бизнес в каталог. Заявка проходит проверку модератором перед публикацией.",
};

export default function AddBusinessPage() {
  return (
    <AuthShell
      subtitle="Заявка проходит проверку модератором — карточка появится в каталоге после одобрения."
      title="Добавить бизнес"
    >
      <AddBusinessForm />
    </AuthShell>
  );
}
