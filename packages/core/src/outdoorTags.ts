// Outdoor need names and labels with no dependencies, safe for client
// components (outdoors.ts itself pulls in zod).

export const DIFFICULTIES = ["easy", "moderate", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const ACCESS_TAGS = ["limited_mobility", "young_kids", "wheelchair"] as const;
export type AccessTag = (typeof ACCESS_TAGS)[number];

export const ACCESS_LABELS: Record<AccessTag, string> = {
  limited_mobility: "Limited mobility",
  young_kids: "Young kids",
  wheelchair: "Wheelchair access",
};

/** The landing page's choices for the hardest outing wanted. */
export const DIFFICULTY_CHOICES: Array<{ value: Difficulty; label: string }> = [
  { value: "easy", label: "Easy walks only" },
  { value: "moderate", label: "Moderate hikes OK" },
  { value: "hard", label: "Up for hard hikes" },
];
