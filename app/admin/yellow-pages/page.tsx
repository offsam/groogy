import { redirect } from "next/navigation";

/** Legacy URL — directories are split per source under /admin/directories. */
export default function AdminYellowPagesRedirect() {
  redirect("/admin/directories");
}
