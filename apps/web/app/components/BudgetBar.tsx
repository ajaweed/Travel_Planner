import { AlertTriangle, FlaskConical, Info } from "lucide-react";
import { CARD_CLASSES, fmtMoney } from "./ui";

type Budget = {
  budgetTotalCents: number;
  committedCents: number;
  pendingCents: number;
  remainingCents: number;
  currency: string;
  overBudget: boolean;
  estimatedCents?: number | null;
};

const pct = (part: number, whole: number) =>
  Math.max(0, Math.min(100, (part / Math.max(whole, 1)) * 100));

// Budget card (docs/visual-design.md §4.3). Stripes always mean "not final";
// solid fill only ever represents real (or test) booked money.
export function BudgetBar({
  budget,
  mode,
  testMode = false,
}: {
  budget: Budget;
  /** null before a plan is chosen. */
  mode: "SELF" | "AI" | null;
  testMode?: boolean;
}) {
  const { currency, budgetTotalCents: total } = budget;
  const card =
    `relative ${CARD_CLASSES} p-5 tabular-nums`;

  // Trips that predate booking modes default to SELF but may hold real
  // (app-booked) spend: those must show the real figures, never "~$0".
  const hasRealSpend = budget.committedCents + budget.pendingCents > 0;
  const effectiveMode =
    mode === "SELF" && hasRealSpend ? "AI" : mode === "SELF" && budget.estimatedCents == null ? null : mode;

  // Before a plan is chosen (or with nothing to show): just the budget, no bar.
  if (effectiveMode === null) {
    return (
      <div className={card}>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">Budget</p>
        <p className="mt-1 text-3xl font-semibold text-ink-900">{fmtMoney(total, currency)}</p>
      </div>
    );
  }

  if (effectiveMode === "SELF") {
    // We never see a real price in SELF mode: nothing here may look like a receipt.
    const est = budget.estimatedCents ?? 0;
    const over = est > total;
    return (
      <div className={`${card} ${over ? "border-l-4 border-l-warning-700" : ""}`}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">Estimated cost</p>
            <p className="mt-1">
              <span className="text-3xl font-semibold text-ink-900">~{fmtMoney(est, currency)}</span>{" "}
              <span className="text-ink-500">of your {fmtMoney(total, currency)} budget</span>
            </p>
          </div>
          {over ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-warning-700">
              <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" />
              Estimated ~{fmtMoney(est - total, currency)} over budget
            </p>
          ) : (
            <p className="text-sm text-ink-700">~{fmtMoney(total - est, currency)} to spare</p>
          )}
        </div>
        <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-sand-100">
          <div
            className={`h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500 ${
              over ? "bg-warning-stripes" : "bg-estimate-stripes"
            }`}
            style={{ width: `${pct(est, total)}%` }}
          />
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
          <Info size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
          Estimate from your plan, not live prices. Final prices are set on each provider’s site when
          you book.
        </p>
      </div>
    );
  }

  // AI mode: real booked money, with the plan estimate as a reference marker.
  const { committedCents: booked, pendingCents: pending } = budget;
  const over = booked + pending > total;
  const est = budget.estimatedCents;
  const estOver = est != null && est > total;
  return (
    <div className={`${card} ${over ? "border-l-4 border-l-danger-700" : ""}`}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
            Budget{testMode ? " · test bookings" : ""}
          </p>
          <p className="mt-1">
            <span className="text-3xl font-semibold text-ink-900">{fmtMoney(booked, currency)}</span>{" "}
            <span className="text-ink-500">booked of {fmtMoney(total, currency)}</span>
          </p>
          {pending > 0 && (
            <p className="mt-0.5 text-sm text-ink-700">+ {fmtMoney(pending, currency)} waiting on confirmation</p>
          )}
        </div>
        {over ? (
          <p className="flex items-center gap-1.5 text-sm font-medium text-danger-700">
            <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" />
            Over budget by {fmtMoney(booked + pending - total, currency)}.
          </p>
        ) : (
          <p className="text-sm text-ink-700">{fmtMoney(budget.remainingCents, currency)} left</p>
        )}
      </div>

      <div className="relative mt-4">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-sand-100">
          <div
            className={`h-full motion-safe:transition-[width] motion-safe:duration-500 ${
              over ? "bg-danger-700" : "bg-lagoon-600"
            }`}
            style={{ width: `${pct(booked, total)}%` }}
          />
          <div
            className="h-full bg-estimate-stripes motion-safe:transition-[width] motion-safe:duration-500"
            style={{ width: `${Math.min(pct(pending, total), 100 - pct(booked, total))}%` }}
          />
        </div>
        {est != null && (
          <span
            aria-hidden="true"
            className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-ink-700"
            style={{ left: `calc(${estOver ? 100 : pct(est, total)}% - 1px)` }}
          />
        )}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-3 rounded-sm bg-lagoon-600" />
          Booked {fmtMoney(booked, currency)}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-3 rounded-sm bg-estimate-stripes" />
          Pending {fmtMoney(pending, currency)}
        </li>
        {est != null && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-ink-700" />
            Plan estimate ~{fmtMoney(est, currency)}
            {estOver ? " (over budget)" : ""}
          </li>
        )}
      </ul>

      {testMode && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500">
          <FlaskConical size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
          Test-mode prices from provider sandboxes. Nothing has been charged.
        </p>
      )}
    </div>
  );
}
