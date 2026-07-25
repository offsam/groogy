import { getPlatformResourceStats } from "@/lib/platform/resource-stats";
import { PlatformResourceCounterClient } from "@/components/layout/PlatformResourceCounterClient";

export async function PlatformResourceCounter() {
  try {
    const stats = await getPlatformResourceStats();
    if (stats.businesses <= 0) return null;
    return <PlatformResourceCounterClient initial={stats} />;
  } catch {
    return null;
  }
}
