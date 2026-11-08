// Original topographic contour-line pattern (drawn for this app; no third-party
// artwork). Decorative only -- stands in for the photography we don't have
// rights to. See docs/visual-design.md §3.

const RINGS = [
  "M600 120c120-6 228 44 262 136 36 98-26 196-140 228-122 34-262 6-324-80-58-82-26-196 60-246 40-24 90-36 142-38z",
  "M598 64c158-8 300 58 344 178 46 128-34 256-184 298-160 44-342 8-424-104-76-108-34-258 80-322 52-32 118-48 184-50z",
  "M596 8c196-10 372 72 426 220 58 158-42 316-228 368-198 54-424 10-524-128-94-134-42-318 98-398 66-40 146-60 228-62z",
  "M594-48c234-12 444 86 508 262 68 188-50 376-272 438-236 64-506 12-626-152-112-160-50-378 118-474 78-46 174-70 272-74z",
  "M592-104c272-14 516 100 590 304 80 218-58 436-316 508-274 74-588 14-726-176-130-186-58-438 136-550 92-54 202-82 316-86z",
  "M240 520c70-30 150-20 196 30 44 48 30 118-30 150-64 34-152 24-196-24-42-46-34-122 30-156z",
  "M214 470c96-42 206-28 268 40 60 66 40 162-42 206-88 46-208 32-268-34-58-62-46-166 42-212z",
  "M188 420c122-54 262-36 340 50 76 84 52 206-54 262-112 58-264 40-340-42-74-80-58-212 54-270z",
];

export function ContourPattern({ opacity = 0.07, className = "" }: { opacity?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 1200 700"
      preserveAspectRatio="xMidYMid slice"
      className={`pointer-events-none absolute inset-0 h-full w-full [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)] ${className}`}
    >
      <g fill="none" stroke="#0E6B66" strokeWidth="1.25" strokeOpacity={opacity}>
        {RINGS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
}
