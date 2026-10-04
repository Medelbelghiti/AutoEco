import { Car, Home, Fuel, Receipt, BarChart3, LineChart, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { MobileAppNav } from "@/components/MobileAppNav";

export function AppShell({ user, children }: { user: { id: string; email: string; name: string | null; role: string }; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-charcoal-900 focus:text-white"
      >
        Skip to content
      </a>
      <Sidebar user={user} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileAppNav email={user.email} role={user.role} />
        <main id="main" className="flex-1 bg-charcoal-50 dark:bg-charcoal-950 pb-20 md:pb-0">
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({ user }: { user: { id: string; email: string; name: string | null; role: string } }) {
  const items = [
    { href: "/dashboard", label: "Dashboard", icon: Home },
    { href: "/garage", label: "Garage", icon: Car },
    { href: "/expenses", label: "Expenses", icon: Receipt },
    { href: "/fuel", label: "Fuel", icon: Fuel },
    { href: "/financial-twin", label: "Financial Twin", icon: LineChart },
    { href: "/scenarios", label: "Scenarios", icon: SlidersHorizontal },
    { href: "/insights", label: "Insights", icon: BarChart3 },
    { href: "/reports", label: "Reports", icon: BarChart3 },
    { href: "/receipts", label: "Receipts", icon: Receipt },
    { href: "/settings", label: "Settings", icon: BarChart3 },
  ];
  return (
    <aside className="hidden md:flex md:w-60 border-r border-charcoal-200 bg-white dark:bg-charcoal-900 dark:border-charcoal-800 md:min-h-screen flex-shrink-0 flex-col">
      <div className="p-4 border-b border-charcoal-200 dark:border-charcoal-800">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-charcoal-900 text-white dark:bg-white dark:text-charcoal-900">
            <Car className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
          <span className="font-bold">AutoEco</span>
        </Link>
      </div>
      <nav className="flex flex-col p-2 gap-1 text-sm flex-1" aria-label="Sections">
        {items.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-charcoal-50 dark:hover:bg-charcoal-800"
          >
            <n.icon className="w-4 h-4 text-charcoal-500" aria-hidden="true" />
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="p-3 border-t border-charcoal-200 dark:border-charcoal-800 text-xs text-charcoal-500">
        <p className="truncate">{user.email}</p>
        <p className="capitalize">{user.role.toLowerCase()}</p>
        <form action="/api/auth/logout" method="post" className="mt-2">
          <button type="submit" className="text-rose-600 underline">
            Log out
          </button>
        </form>
      </div>
    </aside>
  );
}