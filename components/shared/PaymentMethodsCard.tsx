import { Wallet } from "lucide-react";
import { PaymentMethodIcons } from "@/components/shared/PaymentMethodIcons";

export function PaymentMethodsCard({
  methods,
  className,
}: {
  methods: string[] | null | undefined;
  className?: string;
}) {
  const paymentMethods = Array.from(
    new Set((methods ?? []).map((method) => method.trim()).filter(Boolean)),
  );
  if (!paymentMethods.length) return null;

  return (
    <section
      aria-label="Способы оплаты"
      className={[
        "rounded-2xl border border-slate-200 bg-white p-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Wallet aria-hidden className="size-4 text-slate-500" />
        Способы оплаты
      </h2>
      <div className="mt-3">
        <PaymentMethodIcons methods={paymentMethods} showLabels />
      </div>
    </section>
  );
}
