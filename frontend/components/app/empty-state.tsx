/** Empty-state row for a desktop table body. */
export function EmptyRow({ message, colSpan }: { message: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted">
        {message}
      </td>
    </tr>
  );
}

/** Empty-state card for a mobile card list. */
export function EmptyCard({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-edge bg-card px-4 py-10 text-center text-sm text-muted">{message}</div>
  );
}
