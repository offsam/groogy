import { redirect } from "next/navigation";

/** Legacy Master Data → System / Taxonomy. */
export default function AdminMasterDataRedirect() {
  redirect("/admin/system/taxonomy");
}
