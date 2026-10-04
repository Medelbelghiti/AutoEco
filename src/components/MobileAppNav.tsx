"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Car,
  Fuel,
  Home,
  LineChart,
  Menu,
  Receipt,
  Settings as SettingsIcon,
  SlidersHorizontal,
  X,
} from "lucide-react";

type Item = { href: string; label: string; icon: typeof Home };

/** Full navigation. Every one of these must be reachable on a phone. */
const ALL_ITEMS: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/garage", label: "Garage", icon: Car },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/fuel", label: "Fuel", icon: Fuel },
  { href: "/financial-twin", label: "Financial Twin", icon: LineChart },
  { href: "/scenarios", label: "Scenarios", icon: SlidersHorizontal },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/receipts", label: "Receipts", icon: Receipt },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

/** The five shown in the bottom bar. Everything else lives in the drawer. */
const QUICK_ITEMS: Item[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/garage", label: "Garage", icon: Car },
  { href: "/expenses/new", label: "Add", icon: Receipt },
  { href: "/insights", label: "Insights", icon: BarChart3 },
];

export function MobileAppNav({ email, role }: { email: string; role: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
      {/* Mobile top bar — the drawer trigger */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-2 h-14 px-3 bg-white dark:bg-charcoal-900 border-b border-charcoal-200 dark:border-charcoal-800">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold min-w-0">
          <span className="inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-lg bg-charcoal-900 text-white dark:bg-white dark:text-charcoal-900">
            <Car className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
          <span className="truncate">{labelFor(pathname)}</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center w-10 h-10 -mr-1 rounded-lg hover:bg-charcoal-100 dark:hover:bg-charcoal-800"
          aria-expanded={open}
          aria-controls="app-drawer"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-charcoal-900/50"
            onClick={() => setOpen(false)}
            aria-label="Close navigation menu"
            tabIndex={-1}
          />
          <div
            id="app-drawer"
            className="absolute top-0 left-0 h-full w-72 max-w-[85vw] bg-white dark:bg-charcoal-900 border-r border-charcoal-200 dark:border-charcoal-800 flex flex-col"
          >
            <div className="flex items-center justify-between px-4 h-14 border-b border-charcoal-200 dark:border-charcoal-800">
              <span className="font-bold">AutoEco</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center w-10 h-10 rounded-lg hover:bg-charcoal-100 dark:hover:bg-charcoal-800"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-2" aria-label="All sections">
              {ALL_ITEMS.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  aria-current={pathname === n.href ? "page" : undefined}
                  className={`flex items-center gap-3 px-3 py-3 rounded-md text-sm ${
                    pathname === n.href
                      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200 font-medium"
                      : "text-charcoal-700 hover:bg-charcoal-50 dark:text-charcoal-200 dark:hover:bg-charcoal-800"
                  }`}
                >
                  <n.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {n.label}
                </Link>
              ))}
            </nav>

            <div className="border-t border-charcoal-200 dark:border-charcoal-800 p-3 text-xs text-charcoal-500">
              <p className="truncate">{email}</p>
              <p className="capitalize">{role.toLowerCase()}</p>
              <form action="/api/auth/logout" method="post" className="mt-2">
                <button type="submit" className="text-rose-600 underline">
                  Log out
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Bottom quick bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white dark:bg-charcoal-900 border-t border-charcoal-200 dark:border-charcoal-800 flex justify-around items-center h-16 px-1"
        aria-label="Quick navigation"
      >
        {QUICK_ITEMS.map((n) => {
          const isPrimary = n.href === "/expenses/new";
          const active = pathname === n.href;
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] ${
                active && !isPrimary
                  ? "text-emerald-700 dark:text-emerald-300"
                  : "text-charcoal-600 dark:text-charcoal-300"
              }`}
            >
              <span
                className={`inline-flex items-center justify-center ${
                  isPrimary ? "w-10 h-10 -mt-4 rounded-full bg-emerald-600 text-white shadow-lg" : ""
                }`}
              >
                <n.icon className="w-5 h-5" aria-hidden="true" />
              </span>
              {!isPrimary && <span>{n.label}</span>}
              {isPrimary && <span className="sr-only">Add expense</span>}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function labelFor(pathname: string): string {
  const exact = ALL_ITEMS.find((i) => i.href === pathname);
  if (exact) return exact.label;
  if (pathname.startsWith("/expenses/new")) return "Add expense";
  if (pathname.startsWith("/expenses")) return "Expenses";
  if (pathname.startsWith("/fuel/new")) return "Add fuel";
  if (pathname.startsWith("/fuel")) return "Fuel";
  if (pathname.startsWith("/garage/new")) return "Add vehicle";
  if (pathname.startsWith("/garage")) return "Garage";
  if (pathname.startsWith("/settings/billing")) return "Billing";
  if (pathname.startsWith("/settings")) return "Settings";
  return "AutoEco";
}