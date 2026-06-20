import Link from "next/link";

export function Nav() {
  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
        <Link href="/" className="font-semibold text-ink">
          FieldMap
        </Link>
        <Link href="/search" className="text-sm text-neutral-700 hover:text-ink">
          New landscape
        </Link>
        <Link href="/landscapes" className="text-sm text-neutral-700 hover:text-ink">
          Landscapes
        </Link>
        <div className="flex-1" />
        <Link href="/settings" className="text-sm text-neutral-700 hover:text-ink">
          Settings
        </Link>
      </div>
    </nav>
  );
}
