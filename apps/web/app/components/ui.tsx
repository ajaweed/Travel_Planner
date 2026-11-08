// Shared primitives for the Golden Hour look (docs/visual-design.md §2.5).
// Plain components on purpose: no component library.

import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";

export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lagoon-600 focus-visible:ring-offset-2 focus-visible:ring-offset-sand-50";

const BUTTON_BASE = `inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold motion-safe:transition-colors motion-safe:duration-150 motion-safe:active:scale-[0.98] ${FOCUS_RING} disabled:cursor-not-allowed`;

const BUTTON_VARIANTS = {
  // Disabled uses a solid sand fill instead of opacity: faded white-on-white failed contrast.
  primary:
    "bg-lagoon-600 text-white shadow-card hover:bg-lagoon-700 disabled:bg-sand-300 disabled:text-ink-700 disabled:shadow-none",
  secondary:
    "bg-white text-ink-900 ring-1 ring-inset ring-sand-400 hover:bg-sand-100 disabled:bg-sand-100 disabled:text-ink-500",
} as const;

export function buttonClasses(variant: keyof typeof BUTTON_VARIANTS = "primary", extra = ""): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${extra}`;
}

/** The one card surface. Use this rather than re-typing the classes. */
export const CARD_CLASSES = "rounded-2xl border border-sand-200 bg-white shadow-card";

export const INPUT_CLASSES =
  "w-full rounded-xl border border-sand-400 bg-white px-4 py-3 text-ink-900 placeholder:text-ink-500 focus:border-lagoon-600 focus:outline-none focus:ring-2 focus:ring-lagoon-600/30";

export const CHIP_CLASSES = `inline-flex items-center gap-2 rounded-full border border-sand-200 bg-white px-3.5 py-2.5 text-sm text-ink-700 hover:border-lagoon-600 hover:bg-lagoon-50 hover:text-lagoon-700 sm:py-2 ${FOCUS_RING}`;

type Tone = "info" | "warning" | "danger" | "success";

const ALERT_TONES: Record<Tone, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: "bg-info-50 border-info-700", icon: "text-info-700", Icon: Info },
  warning: { box: "bg-warning-50 border-warning-700", icon: "text-warning-700", Icon: AlertTriangle },
  danger: { box: "bg-danger-50 border-danger-700", icon: "text-danger-700", Icon: AlertCircle },
  success: { box: "bg-success-50 border-success-700", icon: "text-success-700", Icon: CheckCircle2 },
};

export function Alert({
  tone,
  children,
  icon,
  className = "",
}: {
  tone: Tone;
  children: ReactNode;
  /** Override the tone's default icon (e.g. a spinner for "still working"). */
  icon?: ReactNode;
  className?: string;
}) {
  const t = ALERT_TONES[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`flex gap-3 rounded-xl border-l-4 p-4 text-sm text-ink-900 ${t.box} ${className}`}
    >
      <span className={`mt-0.5 shrink-0 ${t.icon}`}>
        {icon ?? <t.Icon size={18} strokeWidth={1.75} aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function fmtMoney(cents: number, currency: string, wholeUnits = true): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: wholeUnits ? 0 : 2,
  }).format(cents / 100);
}
