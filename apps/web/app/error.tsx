"use client";

import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-xl mx-auto py-8">
      <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
      <p className="text-sm text-neutral-700 mb-2">
        The page hit an error while loading. This is usually a transient API issue.
      </p>
      <pre className="text-xs bg-neutral-50 border border-neutral-200 rounded p-2 my-3 whitespace-pre-wrap break-all">
        {error.message || String(error)}
      </pre>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="bg-ink text-white px-3 py-1.5 rounded-md text-sm"
        >
          Try again
        </button>
        <Link href="/search" className="border border-neutral-300 px-3 py-1.5 rounded-md text-sm">
          New landscape
        </Link>
      </div>
    </div>
  );
}
