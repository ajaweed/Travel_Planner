"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Plus } from "lucide-react";
import { buttonClasses } from "./ui";

export function SiteHeader() {
  const onTripPage = usePathname()?.startsWith("/trip/") ?? false;
  return (
    <header className="relative z-10">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6 md:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lagoon-600 focus-visible:ring-offset-2 focus-visible:ring-offset-sand-50"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-lagoon-600">
            <Compass size={18} strokeWidth={1.75} className="text-white" aria-hidden="true" />
          </span>
          <span className="font-display text-lg font-semibold text-ink-900">Trip Planner AI</span>
        </Link>
        {onTripPage && (
          <Link href="/" className={buttonClasses("secondary", "px-3.5 py-2")}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            Plan a new trip
          </Link>
        )}
      </div>
    </header>
  );
}
