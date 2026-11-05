const STYLES: Record<string, string> = {
  SEARCHING: "bg-neutral-700 text-neutral-200",
  OPTIONS_FOUND: "bg-blue-900 text-blue-200",
  AWAITING_CONFIRMATION: "bg-amber-900 text-amber-200",
  BOOKED: "bg-emerald-900 text-emerald-200",
  FAILED: "bg-red-900 text-red-200",
  CANCELLED: "bg-neutral-800 text-neutral-400",
};

const LABELS: Record<string, string> = {
  SEARCHING: "Searching…",
  OPTIONS_FOUND: "Options found",
  AWAITING_CONFIRMATION: "Needs your input",
  BOOKED: "Booked",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-neutral-700"}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
