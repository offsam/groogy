import { redirect } from "next/navigation";

/** Legacy queue → Review Center Inbox. */
export default function AdminImportReviewRedirect() {
  redirect("/admin/review/inbox");
}
