import {
  Briefcase,
  Calculator,
  CalendarDays,
  Dog,
  Dumbbell,
  GraduationCap,
  Home,
  Plane,
  Scale,
  Scissors,
  Shield,
  ShoppingBasket,
  Stethoscope,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  restaurants: UtensilsCrossed,
  groceries: ShoppingBasket,
  beauty: Scissors,
  auto: Wrench,
  medical: Stethoscope,
  legal: Scale,
  education: GraduationCap,
  services: Briefcase,
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
  const Icon = (slug && icons[slug]) || Briefcase;
  return <Icon aria-hidden="true" className={className} />;
}
