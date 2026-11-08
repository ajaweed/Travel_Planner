import { Fraunces, Inter } from "next/font/google";

// Display serif for headings; Inter for UI, body and every money figure.
export const display = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  variable: "--font-display",
  display: "swap",
});

export const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
