"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Salad } from "lucide-react";
// Deep import: dependency-light module (zod only); the package index pulls in server code.
import { DIET_LABELS, DIET_TAGS, type DietTag } from "@trip-planner/core/src/dietary";
import { FOCUS_RING, INPUT_CLASSES } from "./ui";

export type DietaryChoice = { requirements: DietTag[]; allergies: string[] };

export const NO_DIETARY_CHOICE: DietaryChoice = { requirements: [], allergies: [] };

/** "peanuts, sesame;shellfish" -> ["peanuts", "sesame", "shellfish"] */
export function parseAllergies(text: string): string[] {
  return [...new Set(text.split(/[,;\n]+/).map((a) => a.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
}

/**
 * Optional dietary needs on the landing form. Collapsed by default so the
 * prompt stays the main thing; opens itself if anything is chosen. What's
 * ticked here is merged into the trip brief in code, so it can't get lost.
 */
export function DietaryPicker({
  value,
  allergiesText,
  onChange,
  onAllergiesTextChange,
  disabled,
}: {
  value: DietaryChoice;
  allergiesText: string;
  onChange: (v: DietaryChoice) => void;
  onAllergiesTextChange: (text: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const allergyId = useId();
  const count = value.requirements.length + parseAllergies(allergiesText).length;

  const toggle = (tag: DietTag) =>
    onChange({
      ...value,
      requirements: value.requirements.includes(tag)
        ? value.requirements.filter((t) => t !== tag)
        : [...value.requirements, tag],
    });

  return (
    <div className="border-t border-sand-100 px-4 py-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-ink-700 hover:text-ink-900 ${FOCUS_RING}`}
      >
        <Salad size={16} strokeWidth={1.75} aria-hidden="true" />
        Dietary needs or allergies?
        {count > 0 && (
          <span className="rounded-full bg-lagoon-50 px-2 py-0.5 text-xs font-semibold text-lagoon-700">{count} added</span>
        )}
        <ChevronDown
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
          className={`motion-safe:transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div id={panelId} className="mt-3 space-y-3">
          <fieldset>
            <legend className="text-xs font-medium text-ink-500">Every restaurant and dish we suggest will respect these.</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DIET_TAGS.map((tag) => {
                const on = value.requirements.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={disabled}
                    onClick={() => toggle(tag)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${FOCUS_RING} ${
                      on
                        ? "border-lagoon-600 bg-lagoon-50 font-medium text-lagoon-700"
                        : "border-sand-200 bg-white text-ink-700 hover:border-lagoon-600"
                    }`}
                  >
                    {on && <Check size={14} strokeWidth={2.25} aria-hidden="true" />}
                    {DIET_LABELS[tag]}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div>
            <label htmlFor={allergyId} className="text-xs font-medium text-ink-500">
              Allergies (comma-separated)
            </label>
            <input
              id={allergyId}
              value={allergiesText}
              onChange={(e) => onAllergiesTextChange(e.target.value)}
              disabled={disabled}
              placeholder="e.g. peanuts, shellfish, sesame"
              className={`mt-1 ${INPUT_CLASSES} py-2 text-sm`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
