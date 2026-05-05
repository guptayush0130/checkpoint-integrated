/**
 * Legacy /runs/[id] route — every Mark1 audit run is now served through
 * /engine/[id] (Phase 4 dashboard). Keep this path alive but redirect
 * server-side so any bookmarks, browser history, or cached form pushes
 * land on the right page.
 */
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LegacyRunRedirect({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/engine/${id}`);
}
