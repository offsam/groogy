import type { ComponentType, SVGProps } from "react";
import {
  Ghost,
  Globe,
  Link2,
  Linkedin,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  PhoneCall,
  Pin,
  Store,
  Twitch,
  Twitter,
  Users,
  Video,
} from "lucide-react";
import {
  FacebookIcon,
  GoogleIcon,
  InstagramIcon,
  TelegramIcon,
  TikTokIcon,
  TrustpilotIcon,
  WhatsAppIcon,
  YelpIcon,
  YouTubeIcon,
} from "@/components/brand/BrandIcons";
import type { ContactChannelId } from "@/lib/contacts/channels";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

const ICONS: Partial<Record<ContactChannelId, IconComponent>> = {
  phone: Phone,
  email: Mail,
  website: Globe,
  whatsapp: WhatsAppIcon,
  telegram: TelegramIcon,
  viber: PhoneCall,
  signal: MessageCircle,
  messenger: MessageCircle,
  wechat: MessageCircle,
  line: MessageCircle,
  skype: Video,
  discord: Users,
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  tiktok: TikTokIcon,
  youtube: YouTubeIcon,
  x: Twitter,
  threads: Users,
  linkedin: Linkedin,
  snapchat: Ghost,
  pinterest: Pin,
  reddit: Users,
  twitch: Twitch,
  vk: Users,
  odnoklassniki: Users,
  yelp: YelpIcon,
  google_maps: GoogleIcon,
  nextdoor: MapPin,
  tripadvisor: MapPin,
  trustpilot: TrustpilotIcon,
  booking: Store,
  opentable: Store,
  zillow: Store,
  etsy: Store,
  custom: Link2,
};

/** Icon for a contact channel — brand mark where we have one, lucide otherwise. */
export function ContactChannelIcon({
  channel,
  className = "size-3.5",
}: {
  channel: ContactChannelId;
  className?: string;
}) {
  const Icon = ICONS[channel] ?? Link2;
  const tinted = channel === "instagram" ? `${className} text-[#E4405F]` : className;
  return <Icon aria-hidden="true" className={tinted} />;
}
