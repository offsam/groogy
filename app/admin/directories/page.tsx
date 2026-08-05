import { redirect } from "next/navigation";

/** Legacy directories → Imports / Directories. */
export default function AdminDirectoriesRedirect() {
  redirect("/admin/imports/directories");
}
