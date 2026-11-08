import type { Metadata } from "next";
import { display, sans } from "./fonts";
import { SiteHeader } from "./components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trip Planner AI",
  description:
    "Describe the trip you want. Compare a few options with estimated costs, then book it yourself from ready-made links or let our AI book it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-screen bg-sand-50 font-sans text-ink-900 antialiased">
        <a
          href="#main"
          className="sr-only rounded-xl bg-lagoon-600 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          Skip to content
        </a>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
