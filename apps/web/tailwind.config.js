/** @type {import('tailwindcss').Config} */
// "Golden Hour" tokens -- see docs/visual-design.md §2. Every text/background
// pair used in the app comes from the measured contrast table there.
module.exports = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sand: { 50: "#FBF7F1", 100: "#F5EEE3", 200: "#EADFCF", 300: "#D9CAB3", 400: "#9A8A73" },
        ink: { 900: "#1F2A33", 700: "#3D4B57", 500: "#5E6B76" },
        lagoon: { 50: "#E2F0EE", 600: "#0E6B66", 700: "#0A5652" },
        sunset: { 50: "#FDF0E6", 600: "#B4502C" },
        // Option tiers (comparison cards only)
        value: { 50: "#E7F1E5", 600: "#2F6B3E" },
        balanced: { 50: "#E5EEF7", 600: "#2B5C8A" },
        elevated: { 50: "#F4E9F2", 600: "#6C3A6E" },
        // Semantic status
        success: { 50: "#E6F4EA", 700: "#1E6B3C" },
        warning: { 50: "#FDF3E1", 700: "#8A5300" },
        danger: { 50: "#FDECEA", 700: "#B42318" },
        info: { 50: "#E5EEF7", 700: "#2B5C8A" },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        "3xl": "1.5rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(31,42,51,0.04), 0 2px 8px rgba(31,42,51,0.05)",
        lift: "0 2px 4px rgba(31,42,51,0.05), 0 12px 32px -8px rgba(31,42,51,0.14)",
        dock: "0 -8px 24px -12px rgba(31,42,51,0.18)",
      },
      backgroundImage: {
        sunrise:
          "radial-gradient(1200px 600px at 10% -10%, #FDE3C8 0%, rgba(253,227,200,0) 60%), radial-gradient(900px 500px at 100% 0%, #D7ECE8 0%, rgba(215,236,232,0) 55%)",
        "estimate-stripes":
          "repeating-linear-gradient(135deg, rgba(14,107,102,0.45) 0 6px, rgba(14,107,102,0.25) 6px 12px)",
        "warning-stripes":
          "repeating-linear-gradient(135deg, rgba(138,83,0,0.45) 0 6px, rgba(138,83,0,0.25) 6px 12px)",
      },
      transitionTimingFunction: {
        "out-soft": "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        rise: "rise 300ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
      },
    },
  },
  plugins: [],
};
