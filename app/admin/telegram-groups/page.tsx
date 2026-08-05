import { redirect } from "next/navigation";

/** Legacy Telegram groups → Imports / Telegram. */
export default function AdminTelegramGroupsRedirect() {
  redirect("/admin/imports/telegram");
}
