import {
  Baby,
  Building2,
  Calculator,
  CalendarDays,
  Camera,
  Car,
  Dog,
  Dumbbell,
  GraduationCap,
  Hammer,
  HandHeart,
  HeartPulse,
  Home,
  Laptop,
  MoreHorizontal,
  Palette,
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
  home_services: Hammer,
  real_estate: Home,
  fitness: Dumbbell,
  pets: Dog,
  finance: Calculator,
  insurance: Shield,
  travel: Plane,
  events: CalendarDays,
  massage_wellness: HandHeart,
  health: HeartPulse,
  childcare: Baby,
  photo_video: Camera,
  home_food: UtensilsCrossed,
  creative: Palette,
  digital: Laptop,
  pro_other: MoreHorizontal,
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
