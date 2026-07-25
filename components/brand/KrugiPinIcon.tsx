import { cn } from "@/lib/utils";

/** Brand pin marks — hub set under the map + legacy sheet pins. */
export const KRUGI_PIN_NAMES = [
  "businesses",
  "services",
  "reviews",
  "listings",
  "jobs",
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

const PIN_SRC: Record<KrugiPinName, string> = {
  businesses: "/brand/pins/hub-businesses.png?v=4",
  services: "/brand/pins/hub-services.png?v=4",
  reviews: "/brand/pins/reviews-v2.png",
  listings: "/brand/pins/hub-marketplace.png?v=4",
  jobs: "/brand/pins/hub-jobs.png?v=4",
  auto: "/brand/pins/hub-auto.png?v=4",
  food: "/brand/pins/hub-food.png?v=4",
  lechu: "/brand/pins/hub-lechu.png?v=4",
  transfers: "/brand/pins/hub-transfers.png?v=4",
  messages: "/brand/pins/messages-v2.png",
  community: "/brand/pins/community-v2.png",
  favorites: "/brand/pins/favorites-v2.png",
  events: "/brand/pins/events-v2.png",
  promos: "/brand/pins/promos-v2.png",
  news: "/brand/pins/news-v2.png",
  profile: "/brand/pins/profile-v2.png",
  verification: "/brand/pins/verification-v2.png",
  reputation: "/brand/pins/reputation-v2.png",
  help: "/brand/pins/help-v2.png",
  settings: "/brand/pins/settings-v2.png",
  logout: "/brand/pins/logout-v2.png",
};

type KrugiPinIconProps = {
  name: KrugiPinName;
  className?: string;
  alt?: string;
};

export function KrugiPinIcon({ name, className, alt = "" }: KrugiPinIconProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand assets
    <img
      alt={alt}
      className={cn("object-contain", className)}
      draggable={false}
      height={256}
      src={PIN_SRC[name]}
      width={256}
    />
  );
}
