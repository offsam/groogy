import {
  Building2,
  Calculator,
  CalendarDays,
  Car,
  Dog,
  Dumbbell,
  GraduationCap,
  Hammer,
  Home,
  Plane,
  Scale,
  Scissors,
  Shield,
  ShoppingBasket,
  Stethoscope,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  restaurants: UtensilsCrossed,
  groceries: ShoppingBasket,
  beauty: Scissors,
  auto: Car,
  medical: Stethoscope,
  legal: Scale,
  education: GraduationCap,
  services: Hammer,
  real_estate: Home,
  fitness: Dumbbell,
  pets: Dog,
  finance: Calculator,
  insurance: Shield,
  travel: Plane,
  events: CalendarDays,
};

export function CategoryIcon({
  slug,
  className,
}: {
  slug: string | null | undefined;
  className?: string;
}) {
  const Icon = (slug && icons[slug]) || Building2;
  return <Icon aria-hidden="true" className={className} strokeWidth={1.75} />;
}
