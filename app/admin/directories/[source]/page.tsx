import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ source: string }>;
};

/** Legacy directory source → Imports / Directories / [source]. */
export default async function AdminDirectorySourceRedirect({
  params,
}: PageProps) {
  const { source } = await params;
  redirect(`/admin/imports/directories/${encodeURIComponent(source)}`);
}
