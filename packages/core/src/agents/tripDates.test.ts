import { describe, expect, it } from "vitest";
import { rollBriefForward, todayISO } from "./tripDates";

describe("todayISO", () => {
  it("formats local date as YYYY-MM-DD", () => {
    expect(todayISO(new Date(2026, 10, 8, 23, 59))).toBe("2026-11-08");
    expect(todayISO(new Date(2027, 0, 3))).toBe("2027-01-03");
  });
});

describe("rollBriefForward", () => {
  const today = "2026-11-08";

  it("moves a past trip to the next occurrence of the same month, keeping its length", () => {
    // The observed bug: "Barcelona in March" planned as March 2025.
    expect(rollBriefForward({ startDate: "2025-03-15", endDate: "2025-03-19" }, today)).toEqual({
      startDate: "2027-03-15",
      endDate: "2027-03-19",
    });
  });

  it("uses this year when the date is later this year", () => {
    expect(rollBriefForward({ startDate: "2025-12-20", endDate: "2026-01-02" }, today)).toEqual({
      startDate: "2026-12-20",
      endDate: "2027-01-02",
    });
  });

  it("leaves today and future dates alone", () => {
    const b = { startDate: today, endDate: "2026-11-12", partySize: 2 };
    expect(rollBriefForward(b, today)).toBe(b);
    const f = { startDate: "2027-06-01" };
    expect(rollBriefForward(f, today)).toBe(f);
  });

  it("leaves missing or malformed dates alone", () => {
    const none = { partySize: 1 } as { startDate?: string; partySize: number };
    expect(rollBriefForward(none, today)).toBe(none);
    const bad = { startDate: "sometime in March" };
    expect(rollBriefForward(bad, today)).toBe(bad);
    const rollover = { startDate: "2025-02-30" };
    expect(rollBriefForward(rollover, today)).toBe(rollover);
  });

  it("moves startDate without inventing an endDate", () => {
    expect(rollBriefForward({ startDate: "2024-07-04" }, today)).toEqual({ startDate: "2027-07-04" });
  });

  it("clamps Feb 29 into a non-leap year instead of drifting to March", () => {
    expect(rollBriefForward({ startDate: "2024-02-29", endDate: "2024-03-03" }, today)).toEqual({
      startDate: "2027-02-28",
      endDate: "2027-03-03",
    });
  });

  it("preserves the other brief fields", () => {
    const out = rollBriefForward({ startDate: "2025-03-15", destinations: ["Barcelona"] }, today);
    expect(out.destinations).toEqual(["Barcelona"]);
  });
});
