/**
 * Renders a pre-computed error message in the shared red-text shell. Takes
 * the final string rather than an Error/ApiError instance because each page
 * has slightly different fallback logic for picking that string (e.g.
 * ApiError-only vs. any Error) — this only consolidates the repeated JSX.
 */
export function ErrorState({ message, spacing = "mb-4" }: { message: string; spacing?: string }) {
  return <p className={`${spacing} text-sm text-red-400`}>{message}</p>;
}
