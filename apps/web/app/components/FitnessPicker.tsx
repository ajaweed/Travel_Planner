"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Footprints } from "lucide-react";
// Deep import of a dependency-free module: the package index pulls in server code.
import { ACCESS_LABELS, ACCESS_TAGS, DIFFICULTY_CHOICES, type AccessTag, type Difficulty } from "@trip-planner/core/src/outdoorTags";
import { FOCUS_RING } from "./ui";

export type FitnessChoice = { maxDifficulty?: Difficulty; access: AccessTag[] };
export const NO_FITNESS_CHOICE: FitnessChoice = { access: [] };

function Chip({
  on,
  role,
  onClick,
  disabled,
  children,
}: {
  on: boolean;
  role: "radio" | "checkbox";
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${FOCUS_RING} ${
        on ? "border-lagoon-600 bg-lagoon-50 font-medium text-lagoon-700" : "border-sand-200 bg-white text-ink-700 hover:border-lagoon-600"
      }`}
    >
      {on && <Check size={14} strokeWidth={2.25} aria-hidden="true" />}
      {children}
    </button>
  );
}

/**
 * Optional fitness/access needs for hikes and nature outings, on the landing
 * form next to the dietary picker. Collapsed by default; the toggle shows a
 * count. Merged into the trip brief in code, so it can't get lost.
 */
export function FitnessPicker({
  value,
  onChange,
  disabled,
}: {
  value: FitnessChoice;
  onChange: (v: FitnessChoice) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const count = (value.maxDifficulty ? 1 : 0) + value.access.length;

  return (
    <div className="border-t border-sand-100 px-4 py-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-ink-700 hover:text-ink-900 ${FOCUS_RING}`}
      >
        <Footprints size={16} strokeWidth={1.75} aria-hidden="true" />
        Fitness or access needs?
        {count > 0 && (
          <span className="rounded-full bg-lagoon-50 px-2 py-0.5 text-xs font-semibold text-lagoon-700">{count} added</span>
        )}
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" className={`motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div id={panelId} className="mt-3 space-y-3">
          <div role="radiogroup" aria-label="Hardest walk or hike you want">
            <p className="text-xs font-medium text-ink-500">Hikes and walks we plan will stay within this.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DIFFICULTY_CHOICES.map(({ value: d, label }) => (
                <Chip
                  key={d}
                  role="radio"
                  on={value.maxDifficulty === d}
                  disabled={disabled}
                  // Click again to clear: "no preference" is a valid answer.
                  onClick={() => onChange({ ...value, maxDifficulty: value.maxDifficulty === d ? undefined : d })}
                >
                  {label}
                </Chip>
              ))}
            </div>
          </div>
          <fieldset>
            <legend className="text-xs font-medium text-ink-500">Access</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {ACCESS_TAGS.map((tag) => {
                const on = value.access.includes(tag);
                return (
                  <Chip
                    key={tag}
                    role="checkbox"
                    on={on}
                    disabled={disabled}
                    onClick={() =>
                      onChange({ ...value, access: on ? value.access.filter((t) => t !== tag) : [...value.access, tag] })
                    }
                  >
                    {ACCESS_LABELS[tag]}
                  </Chip>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}
