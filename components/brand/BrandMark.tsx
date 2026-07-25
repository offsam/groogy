import Image from "next/image";
import { cn } from "@/lib/utils";

const MARK_SRC = "/brand/krugi-mark-256.png";

type BrandMarkProps = {
  className?: string;
  size?: number;
  priority?: boolean;
};

/** Official КРУГИ pin mark (K in map pin). */
export function BrandMark({
  className,
  size = 32,
  priority = false,
}: BrandMarkProps) {
  return (
    <Image
      alt=""
      aria-hidden
      className={cn("shrink-0 object-contain", className)}
      height={size}
      priority={priority}
      src={MARK_SRC}
      width={size}
    />
  );
}
