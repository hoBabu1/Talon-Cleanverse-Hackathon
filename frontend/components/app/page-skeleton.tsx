/** Thin animated placeholder line, matching the loading text used across pages. */
export function LineSkeleton({ className = "w-64" }: { className?: string }) {
  return <p className={`mb-4 h-4 ${className} animate-pulse rounded bg-white/5 text-sm text-transparent`}>loading</p>;
}

/** Row-shaped shimmer for a desktop table body. */
export function RowSkeleton({ rows = 4, colSpan = 4 }: { rows?: number; colSpan?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-edge last:border-0">
          <td className="px-4 py-3" colSpan={colSpan}>
            <div className="h-5 w-full animate-pulse rounded-card bg-white/5" />
          </td>
        </tr>
      ))}
    </>
  );
}

/** Card-shaped shimmer for a mobile card list. */
export function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-card border border-edge bg-card" />
      ))}
    </>
  );
}
