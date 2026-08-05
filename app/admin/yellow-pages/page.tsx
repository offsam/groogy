import { redirect } from "next/navigation";

/** Legacy Yellow Pages alias → Imports / Directories. */
export default function AdminYellowPagesRedirect() {
  redirect("/admin/imports/directories");
}
