import Link from "next/link";
import { apiGet, Landscape } from "../../lib/api";

export const dynamic = "force-dynamic";

export default async function LandscapesList() {
  let rows: Landscape[] = [];
  let err: string | null = null;
  try {
    rows = await apiGet<Landscape[]>("/api/landscapes");
  } catch (e: any) {
    err = e?.message || String(e);
  }
  if (err) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold mb-2">Landscapes</h1>
        <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md p-3 mb-3">
          Couldn&apos;t reach the API: <span className="font-mono">{err}</span>
        </div>
        <Link href="/search" className="border border-neutral-300 px-3 py-1.5 rounded-md text-sm">
          New landscape
        </Link>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Landscapes</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No landscapes yet. <Link href="/search">Start one →</Link>
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 border border-neutral-200 rounded-md bg-white">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <Link href={`/landscape/${r.id}`} className="font-medium">
                  {r.topic}
                </Link>
                <div className="text-xs text-neutral-500">
                  status: {r.status} · created {new Date(r.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-3 text-sm">
                <Link href={`/landscape/${r.id}/papers`}>Papers</Link>
                <Link href={`/landscape/${r.id}/quiz`}>Quiz</Link>
                <Link href={`/landscape/${r.id}/flashcards`}>Flashcards</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
