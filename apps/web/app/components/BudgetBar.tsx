type Budget = {
  budgetTotalCents: number;
  committedCents: number;
  pendingCents: number;
  remainingCents: number;
  currency: string;
  overBudget: boolean;
};

function fmt(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function BudgetBar({ budget }: { budget: Budget }) {
  const spentPct = Math.min(
    100,
    Math.round(((budget.committedCents + budget.pendingCents) / Math.max(budget.budgetTotalCents, 1)) * 100),
  );

  return (
    <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-neutral-400">Budget</span>
        <span className={budget.overBudget ? "text-sm font-medium text-red-400" : "text-sm text-neutral-300"}>
          {fmt(budget.committedCents + budget.pendingCents, budget.currency)} / {fmt(budget.budgetTotalCents, budget.currency)}
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className={`h-full ${budget.overBudget ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${spentPct}%` }}
        />
      </div>
      {budget.pendingCents > 0 && (
        <p className="mt-2 text-xs text-neutral-500">
          Includes {fmt(budget.pendingCents, budget.currency)} pending confirmation.
        </p>
      )}
      {budget.overBudget && (
        <p className="mt-2 text-xs text-red-400">
          Over budget by {fmt(Math.abs(budget.remainingCents), budget.currency)}.
        </p>
      )}
    </div>
  );
}
