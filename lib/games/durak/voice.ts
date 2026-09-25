import "server-only";

import { AccessToken } from "livekit-server-sdk";
import { createServerClient } from "@/lib/supabase/server";

const ROOM = "durak-table-1";

export type DurakVoiceTicket =
  | { ok: true; token: string; url: string }
  | { ok: false; message: string };

function websocketUrl(raw: string): string | null {
  const url = raw.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  if (!/^wss:\/\//.test(url)) return null;
  return url;
}

/** Short-lived join token for the table room. API secret stays on the server. */
export async function issueDurakVoiceToken(
  guestId: string,
): Promise<DurakVoiceTicket> {
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  const url = websocketUrl(process.env.LIVEKIT_URL?.trim() ?? "");
  if (!apiKey || !apiSecret || !url) {
    return { ok: false, message: "Голосовой чат ещё не настроен." };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let identity = "";
  let name = "Зритель";
  if (user) {
    identity = user.id;
    const { data } = await supabase
      .from("profiles")
      .select("display_name, username")
      .eq("id", user.id)
      .maybeSingle();
    name = data?.display_name?.trim() || data?.username?.trim() || "Игрок";
  } else if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      guestId,
    )
  ) {
    identity = `guest-${guestId}`;
  }
  if (!identity) {
    return { ok: false, message: "Не удалось открыть голос." };
  }

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: "2h",
  });
  token.addGrant({
    room: ROOM,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });

  return { ok: true, token: await token.toJwt(), url };
}
