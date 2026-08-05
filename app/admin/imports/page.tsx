import { redirect } from "next/navigation";

/** Legacy Imports hub → sources / queue hub. */
export default function AdminImportsIndexPage() {
  redirect("/admin/queue");
}
