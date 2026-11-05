// Claude's tool-use occasionally double-encodes a field on complex/deeply
// nested schemas: instead of a native array/object, the field comes back as
// a JSON string -- sometimes even re-wrapped in an object with the same key
// (e.g. `{ days: '{"days":[...]}' }`). This repairs that specific, observed
// failure mode before validation, rather than silently trusting raw LLM
// tool-call JSON (see backend-dev.md).
export function coerceStringifiedFields(
  input: Record<string, unknown>,
  fieldNames: string[],
): Record<string, unknown> {
  const out = { ...input };
  for (const field of fieldNames) {
    const value = out[field];
    if (typeof value !== "string") continue;
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && field in parsed) {
        out[field] = (parsed as Record<string, unknown>)[field];
      } else {
        out[field] = parsed;
      }
    } catch {
      // Not JSON -- leave as-is and let schema validation report the real error.
    }
  }
  return out;
}
