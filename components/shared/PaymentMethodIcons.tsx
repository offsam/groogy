import type { ReactNode, SVGProps } from "react";
import { Banknote, CreditCard, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function PayPalMark({ className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden
      className={cn("shrink-0", className)}
      viewBox="0 0 24 24"
      {...props}
    >
      <rect fill="#003087" height="24" rx="6" width="24" />
      <path
        d="M9.2 17.2 10 12.4h2.55c1.7 0 2.95-.35 3.65-1.15.55-.65.75-1.5.6-2.55-.35-2.35-1.95-3.35-4.7-3.35H8.35L6.8 17.2h2.4zm2.05-7.55h1.15c1.35 0 2.1.45 2.3 1.55.15.85-.2 1.4-.95 1.4H12.1l.15-2.95z"
        fill="#fff"
      />
      <path
        d="M14.85 8.85c-.2 1.3-.95 2.15-2.2 2.45l-.55 3.4h2.35l.7-4.3c.2-1.2.05-1.85-.3-1.55z"
        fill="#009CDE"
        opacity=".9"
      />
    </svg>
  );
}

function VenmoMark({ className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden
      className={cn("shrink-0", className)}
      viewBox="0 0 24 24"
      {...props}
    >
      <rect fill="#008CFF" height="24" rx="6" width="24" />
      <path
        d="M17.2 6.4c.35.55.55 1.15.55 1.95 0 2.45-2.1 5.65-3.8 7.85H9.55L8.05 6.85h3.55l.85 6.5c.9-1.45 2-3.5 2-4.85 0-.55-.1-.95-.3-1.25l3.05-.85z"
        fill="#fff"
      />
    </svg>
  );
}

function ZelleMark({ className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden
      className={cn("shrink-0", className)}
      viewBox="0 0 24 24"
      {...props}
    >
      <rect fill="#6D1ED4" height="24" rx="6" width="24" />
      <path
        d="M7.2 7.2h9.6v2.1L11.4 14h5.4v2.8H7.2v-2.1L12.6 10H7.2V7.2z"
        fill="#fff"
      />
    </svg>
  );
}

function CashAppMark({ className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden
      className={cn("shrink-0", className)}
      viewBox="0 0 24 24"
      {...props}
    >
      <rect fill="#00C244" height="24" rx="6" width="24" />
      <path
        d="M13.6 6.4c1.55.35 2.55 1.35 2.85 2.85l-2.15.55c-.15-.7-.6-1.1-1.35-1.25V16.4h-2.1v-1.9c-1.7-.2-2.95-1.15-3.15-2.85l2.2-.5c.15.75.7 1.15 1.45 1.3V7.55c1.15-.15 1.85.2 2.25-.15.15-.15.15-.4 0-.55-.35-.4-1.05-.55-2.05-.35V4.85c2.05-.35 3.45.35 3.95 1.55z"
        fill="#fff"
      />
    </svg>
  );
}

function ApplePayMark({ className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden
      className={cn("shrink-0", className)}
      viewBox="0 0 24 24"
      {...props}
    >
      <rect fill="#111" height="24" rx="6" width="24" />
      <path
        d="M11.05 8.55c.35-.45.6-1.05.55-1.65-.55.05-1.2.4-1.55.85-.35.4-.65 1.05-.55 1.65.6.05 1.2-.35 1.55-.85zm.35 1.05c-.9-.05-1.65.5-2.1.5-.45 0-1.1-.45-1.85-.45-1.05.05-2 .6-2.55 1.55-1.05 1.85-.3 4.55.75 6.05.5.75 1.1 1.55 1.9 1.5.75-.05 1.05-.5 1.95-.5s1.15.45 1.95.5c.8.05 1.35-.75 1.85-1.5.55-.85.8-1.65.8-1.7-.05 0-1.55-.6-1.55-2.35 0-1.5 1.2-2.2 1.25-2.25-.7-.95-1.7-1.1-2.05-1.1-.85-.05-1.55.5-1.35.35z"
        fill="#fff"
      />
    </svg>
  );
}

function GooglePayMark({ className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden
      className={cn("shrink-0", className)}
      viewBox="0 0 24 24"
      {...props}
    >
      <rect fill="#fff" height="24" rx="6" stroke="#E5E7EB" width="24" />
      <path
        d="M12.9 12.15v1.9h3.05c-.15.85-.55 1.5-1.15 1.95-.65.5-1.5.8-2.55.8-2.15 0-3.9-1.75-3.9-3.9s1.75-3.9 3.9-3.9c1.1 0 2 .4 2.65 1.05l1.35-1.35C15.2 7.65 13.9 7.1 12.25 7.1 9.05 7.1 6.5 9.65 6.5 12.85s2.55 5.75 5.75 5.75c1.7 0 3-.55 4-1.6 1.05-1.05 1.4-2.5 1.4-3.7 0-.35-.05-.7-.1-1h-5.65v.85z"
        fill="#4285F4"
      />
    </svg>
  );
}

function VisaMark({ className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden
      className={cn("shrink-0", className)}
      viewBox="0 0 24 24"
      {...props}
    >
      <rect fill="#1A1F71" height="24" rx="6" width="24" />
      <path
        d="M10.05 15.4 11.2 8.6h1.85l-1.15 6.8h-1.85zm7.35-6.55c-.35-.15-.95-.3-1.65-.3-1.85 0-3.15 1-3.15 2.4 0 1.05.95 1.65 1.7 2 .75.35 1.05.6 1.05.95 0 .5-.6.75-1.15.75-.75 0-1.2-.1-1.85-.4l-.25-.1-.3 1.75c.5.25 1.4.4 2.35.4 2 0 3.3-1 3.3-2.5 0-.85-.5-1.5-1.7-2.05-.7-.35-1.15-.6-1.15-.95 0-.35.4-.7 1.2-.7.7 0 1.2.15 1.55.3l.2.1.3-1.65zM19.9 8.6h-1.45c-.45 0-.8.15-1 .7l-2.8 6.7h1.95l.4-1.1h2.4l.2 1.1H21l-1.1-7.4zm-2.05 4.7.8-2.25.15-.35.2-.55.05.3.25 1.25.3 1.6h-1.75zM9.05 8.6 7.15 13.7l-.2-1.05C6.6 11.15 5.4 9.85 4 9.2l1.8 6.2h1.95L10.95 8.6H9.05zM5.55 8.6H2.6L2.55 8.8c2.25.55 3.75 1.9 4.35 3.5L6.05 9.3c-.1-.55-.45-.7-.85-.7H5.55z"
        fill="#fff"
      />
    </svg>
  );
}

function MastercardMark({ className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden
      className={cn("shrink-0", className)}
      viewBox="0 0 24 24"
      {...props}
    >
      <rect fill="#111" height="24" rx="6" width="24" />
      <circle cx="9.5" cy="12" fill="#EB001B" r="4.2" />
      <circle cx="14.5" cy="12" fill="#F79E1B" r="4.2" />
      <path
        d="M12 8.85a4.18 4.18 0 0 1 1.55 3.15A4.18 4.18 0 0 1 12 15.15 4.18 4.18 0 0 1 10.45 12 4.18 4.18 0 0 1 12 8.85z"
        fill="#FF5F00"
      />
    </svg>
  );
}

function TileIcon({
  className,
  bg,
  children,
}: {
  className?: string;
  bg: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-md text-white",
        bg,
        className,
      )}
    >
      {children}
    </span>
  );
}

export type PaymentMethodVisual = {
  key: string;
  label: string;
  icon: ReactNode;
};

function normalizeMethodKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Map enrich / stored labels → payment marks. Unknown methods get a generic wallet. */
export function paymentMethodVisual(method: string): PaymentMethodVisual | null {
  const key = normalizeMethodKey(method);
  if (!key) return null;

  if (/paypal|пейпал/.test(key)) {
    return { key: "paypal", label: "PayPal", icon: <PayPalMark className="size-6" /> };
  }
  if (/venmo|вемо/.test(key)) {
    return { key: "venmo", label: "Venmo", icon: <VenmoMark className="size-6" /> };
  }
  if (/zelle|зелл/.test(key)) {
    return { key: "zelle", label: "Zelle", icon: <ZelleMark className="size-6" /> };
  }
  if (/cash\s*app|cashapp/.test(key)) {
    return {
      key: "cashapp",
      label: "Cash App",
      icon: <CashAppMark className="size-6" />,
    };
  }
  if (/apple\s*pay/.test(key)) {
    return {
      key: "applepay",
      label: "Apple Pay",
      icon: <ApplePayMark className="size-6" />,
    };
  }
  if (/google\s*pay|g\s*pay/.test(key)) {
    return {
      key: "googlepay",
      label: "Google Pay",
      icon: <GooglePayMark className="size-6" />,
    };
  }
  if (/visa/.test(key)) {
    return { key: "visa", label: "Visa", icon: <VisaMark className="size-6" /> };
  }
  if (/mastercard|master\s*card|мастер\s*кард/.test(key)) {
    return {
      key: "mastercard",
      label: "Mastercard",
      icon: <MastercardMark className="size-6" />,
    };
  }
  if (/карт|card|credit|debit|дебет/.test(key)) {
    return {
      key: "card",
      label: "Карта",
      icon: (
        <TileIcon bg="bg-slate-800">
          <CreditCard className="size-3.5" aria-hidden />
        </TileIcon>
      ),
    };
  }
  if (/^cash$|налич|кэш|нал$/.test(key)) {
    return {
      key: "cash",
      label: "Наличные",
      icon: (
        <TileIcon bg="bg-emerald-600">
          <Banknote className="size-3.5" aria-hidden />
        </TileIcon>
      ),
    };
  }
  if (/check|cheque|чек/.test(key)) {
    return {
      key: "check",
      label: "Check",
      icon: (
        <TileIcon bg="bg-slate-600">
          <Wallet className="size-3.5" aria-hidden />
        </TileIcon>
      ),
    };
  }

  return {
    key: `other:${key}`,
    label: method.trim(),
    icon: (
      <TileIcon bg="bg-slate-200" className="text-slate-700">
        <Wallet className="size-3.5" aria-hidden />
      </TileIcon>
    ),
  };
}

export function PaymentMethodIcons({
  methods,
  className,
  showLabels = false,
  size = "md",
}: {
  methods: string[] | null | undefined;
  className?: string;
  /** Show short label next to each mark (payment block). */
  showLabels?: boolean;
  size?: "sm" | "md";
}) {
  const seen = new Set<string>();
  const visuals: PaymentMethodVisual[] = [];
  for (const raw of methods ?? []) {
    const visual = paymentMethodVisual(raw);
    if (!visual || seen.has(visual.key)) continue;
    seen.add(visual.key);
    visuals.push(visual);
  }
  if (visuals.length === 0) return null;

  const iconScale = size === "sm" ? "[&_svg]:size-5 [&_span.size-6]:size-5" : "";

  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-2",
        iconScale,
        className,
      )}
      aria-label="Способы оплаты"
    >
      {visuals.map((v) => (
        <li
          key={v.key}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-1.5 py-1 ring-1 ring-black/5",
            showLabels && "pr-2",
          )}
          title={v.label}
        >
          {v.icon}
          {showLabels ? (
            <span className="text-xs font-medium text-slate-700">{v.label}</span>
          ) : (
            <span className="sr-only">{v.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
