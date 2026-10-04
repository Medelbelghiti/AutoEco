"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";

export type NavLink = { href: string; label: string };

/**
 * Marketing header navigation.
 *
 * Below `md` the links collapse into a disclosure panel. Without this the
 * Features / Calculators / Pricing / Docs links were `hidden md:flex` and
 * completely unreachable on a phone.
 */
export function MarketingNav({
  links,
  headerActions,
  panelActions,
}: {
  links: NavLink[];
  headerActions: React.ReactNode;
  panelActions: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // Close on Escape, and lock body scroll while the panel is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* Desktop links */}
      <nav className="hidden md:flex items-center gap-6 text-sm" aria-label="Main">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="text-charcoal-600 hover:text-charcoal-900 dark:text-charcoal-300 dark:hover:text-white"
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* The full action set needs ~640px; below that it is in the panel. */}
        <div className="hidden sm:flex items-center gap-2">{headerActions}</div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-charcoal-700 hover:bg-charcoal-100 dark:text-charcoal-200 dark:hover:bg-charcoal-800"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* Mobile disclosure panel */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-charcoal-900/50"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            tabIndex={-1}
          />
          <div
            id="mobile-nav"
            className="absolute top-0 right-0 h-full w-72 max-w-[85vw] bg-white dark:bg-charcoal-900 border-l border-charcoal-200 dark:border-charcoal-800 flex flex-col"
          >
            <div className="flex items-center justify-between px-4 h-16 border-b border-charcoal-200 dark:border-charcoal-800">
              <span className="font-semibold">Menu</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-charcoal-100 dark:hover:bg-charcoal-800"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-2" aria-label="Mobile">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-3 rounded-md text-charcoal-700 hover:bg-charcoal-50 dark:text-charcoal-200 dark:hover:bg-charcoal-800"
                >
                  {l.label}
                </Link>
              ))}
            </nav>

            {/* Auth actions are always reachable on mobile, not just >=sm. */}
            <div className="border-t border-charcoal-200 dark:border-charcoal-800 p-4 flex flex-col gap-2">
              {panelActions}
            </div>
          </div>
        </div>
      )}
    </>
  );
}