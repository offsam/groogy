import {
  ArrowLeftRight,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Car,
  CircleHelp,
  Heart,
  Home,
  LogOut,
  Megaphone,
  MessageCircle,
  Newspaper,
  Plane,
  Settings,
  ShoppingBag,
  Star,
  Trophy,
  Users,
  UserRound,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Brand pin marks — hub set under the map + legacy sheet pins. */
export const KRUGI_PIN_NAMES = [
  "businesses",
  "professionals",
  "services",
  "reviews",
  "listings",
  "jobs",
  "real_estate",
  "auto",
  "food",
  "lechu",
  "transfers",
  "messages",
  "community",
  "favorites",
  "events",
  "promos",
  "news",
  "profile",
  "verification",
  "reputation",
  "help",
  "settings",
  "logout",
] as const;

export type KrugiPinName = (typeof KRUGI_PIN_NAMES)[number];

const PIN_ICONS: Record<KrugiPinName, LucideIcon> = {
  businesses: Building2,
  professionals: UserRound,
  services: Wrench,
  reviews: Star,
  listings: ShoppingBag,
  jobs: BriefcaseBusiness,
  real_estate: Home,
  auto: Car,
  food: UtensilsCrossed,
  lechu: Plane,
  transfers: ArrowLeftRight,
  messages: MessageCircle,
  community: Users,
  favorites: Heart,
  events: CalendarDays,
  promos: Megaphone,
  news: Newspaper,
  profile: UserRound,
  verification: BadgeCheck,
  reputation: Trophy,
  help: CircleHelp,
  settings: Settings,
  logout: LogOut,
};

/** Soft disc + brand accent — replaces soft AI PNG pins. */
const PIN_STYLE: Record<
  KrugiPinName,
  { disc: string; ink: string }
> = {
  businesses: {
    disc: "bg-gradient-to-br from-sky-50 to-brand-blue/15 ring-1 ring-brand-blue/20",
    ink: "text-brand-blue-deep",
  },
  professionals: {
    disc: "bg-gradient-to-br from-emerald-50 to-brand-green/20 ring-1 ring-brand-green/25",
    ink: "text-brand-green-deep",
  },
  services: {
    disc: "bg-gradient-to-br from-emerald-50 to-brand-green/20 ring-1 ring-brand-green/25",
    ink: "text-brand-green-deep",
  },
  reviews: {
    disc: "bg-gradient-to-br from-amber-50 to-brand-yellow/30 ring-1 ring-brand-orange/20",
    ink: "text-brand-orange",
  },
  listings: {
    disc: "bg-gradient-to-br from-orange-50 to-brand-orange/20 ring-1 ring-brand-orange/25",
    ink: "text-brand-orange",
  },
  jobs: {
    disc: "bg-gradient-to-br from-slate-50 to-slate-200/80 ring-1 ring-slate-300/60",
    ink: "text-slate-700",
  },
  real_estate: {
    disc: "bg-gradient-to-br from-sky-50 to-brand-blue/10 ring-1 ring-brand-blue/20",
    ink: "text-brand-blue-deep",
  },
  auto: {
    disc: "bg-gradient-to-br from-slate-50 to-slate-200/70 ring-1 ring-slate-300/50",
    ink: "text-slate-800",
  },
  food: {
    disc: "bg-gradient-to-br from-red-50 to-brand-red/15 ring-1 ring-brand-red/20",
    ink: "text-brand-red",
  },
  lechu: {
    disc: "bg-gradient-to-br from-sky-50 to-sky-200/50 ring-1 ring-sky-300/50",
    ink: "text-sky-700",
  },
  transfers: {
    disc: "bg-gradient-to-br from-emerald-50 to-teal-100/80 ring-1 ring-teal-300/40",
    ink: "text-teal-700",
  },
  messages: {
    disc: "bg-gradient-to-br from-sky-50 to-brand-blue/15 ring-1 ring-brand-blue/20",
    ink: "text-brand-blue-deep",
  },
  community: {
    disc: "bg-gradient-to-br from-violet-50 to-fuchsia-100/60 ring-1 ring-fuchsia-200/60",
    ink: "text-fuchsia-700",
  },
  favorites: {
    disc: "bg-gradient-to-br from-rose-50 to-brand-red/15 ring-1 ring-brand-red/20",
    ink: "text-brand-red",
  },
  events: {
    disc: "bg-gradient-to-br from-amber-50 to-brand-yellow/25 ring-1 ring-brand-orange/20",
    ink: "text-brand-orange",
  },
  promos: {
    disc: "bg-gradient-to-br from-orange-50 to-brand-orange/20 ring-1 ring-brand-orange/25",
    ink: "text-brand-orange",
  },
  news: {
    disc: "bg-gradient-to-br from-slate-50 to-slate-200/70 ring-1 ring-slate-300/50",
    ink: "text-slate-700",
  },
  profile: {
    disc: "bg-gradient-to-br from-sky-50 to-brand-blue/15 ring-1 ring-brand-blue/20",
    ink: "text-brand-blue-deep",
  },
  verification: {
    disc: "bg-gradient-to-br from-emerald-50 to-brand-green/20 ring-1 ring-brand-green/25",
    ink: "text-brand-green-deep",
  },
  reputation: {
    disc: "bg-gradient-to-br from-amber-50 to-brand-yellow/30 ring-1 ring-brand-orange/20",
    ink: "text-brand-orange",
  },
  help: {
    disc: "bg-gradient-to-br from-sky-50 to-sky-100 ring-1 ring-sky-200/70",
    ink: "text-sky-700",
  },
  settings: {
    disc: "bg-gradient-to-br from-slate-50 to-slate-200/80 ring-1 ring-slate-300/60",
    ink: "text-slate-700",
  },
  logout: {
    disc: "bg-gradient-to-br from-slate-50 to-slate-200/80 ring-1 ring-slate-300/60",
    ink: "text-slate-600",
  },
};

type KrugiPinIconProps = {
  name: KrugiPinName;
  className?: string;
  alt?: string;
};

export function KrugiPinIcon({ name, className, alt = "" }: KrugiPinIconProps) {
  const Icon = PIN_ICONS[name];
  const style = PIN_STYLE[name];

  return (
    <span
      aria-hidden={alt ? undefined : true}
      aria-label={alt || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full shadow-[0_6px_16px_rgba(15,23,42,0.08)]",
        style.disc,
        className,
      )}
      role={alt ? "img" : undefined}
    >
      <Icon
        aria-hidden
        className={cn("size-[48%] stroke-[1.75]", style.ink)}
      />
    </span>
  );
}
