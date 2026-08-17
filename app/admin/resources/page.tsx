import { redirect } from "next/navigation";

export default function AdminResourcesRedirect() {
  redirect("/admin/sources");
}
