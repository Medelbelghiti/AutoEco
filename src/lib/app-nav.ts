import {
  BarChart3,
  Car,
  Fuel,
  Home,
  LineChart,
  MapPin,
  Receipt,
  Route,
  Settings as SettingsIcon,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { translator, type Locale } from "@/lib/i18n";

export type NavItem = { href: string; key: string; icon: LucideIcon };

/**
 * The navigation, declared once.
 *
 * The sidebar (server) and the mobile drawer and bottom bar (client) used to
 * carry three separate copies of the same list, which is how "Financial Twin"
 * ended up in two of them and not the third. One list, translated at the
 * render site, keeps them in step and makes every label a translatable key.
 */
export const APP_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", key: "nav.dashboard", icon: Home },
  { href: "/garage", key: "nav.garage", icon: Car },
  { href: "/expenses", key: "nav.expenses", icon: Receipt },
  { href: "/fuel", key: "nav.fuel", icon: Fuel },
  { href: "/trips", key: "nav.trips", icon: Route },
  { href: "/financial-twin", key: "nav.financial_twin", icon: LineChart },
  { href: "/scenarios", key: "nav.scenarios", icon: SlidersHorizontal },
  { href: "/insights", key: "nav.insights", icon: BarChart3 },
  { href: "/reports", key: "nav.reports", icon: BarChart3 },
  { href: "/receipts", key: "nav.receipts", icon: Receipt },
  { href: "/settings", key: "nav.settings", icon: SettingsIcon },
];

/** The four shown in the phone bottom bar. Everything else lives in the drawer. */
export const QUICK_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", key: "nav.home", icon: Home },
  { href: "/garage", key: "nav.garage", icon: Car },
  { href: "/expenses/new", key: "nav.add", icon: Receipt },
  { href: "/insights", key: "nav.insights", icon: BarChart3 },
];

/**
 * Heading for the mobile top bar, which has no room for the full list.
 *
 * Routes are matched most-specific first so `/expenses/new` reads "Add
 * expense" rather than inheriting the section title.
 */
export function navTitleKey(pathname: string): string {
  const exact = APP_NAV_ITEMS.find((i) => i.href === pathname);
  if (exact) return exact.key;
  const prefixes: [string, string][] = [
    ["/expenses/new", "nav.add_expense"],
    ["/expenses", "nav.expenses"],
    ["/fuel/new", "nav.add_fuel"],
    ["/fuel", "nav.fuel"],
    ["/trips/new", "nav.add_trip"],
    ["/trips", "nav.trips"],
    ["/garage/new", "nav.add_vehicle"],
    ["/garage", "nav.garage"],
    ["/settings/billing", "nav.billing"],
    ["/settings", "nav.settings"],
    ["/receipts", "nav.receipts"],
    ["/financial-twin", "nav.financial_twin"],
    ["/scenarios", "nav.scenarios"],
    ["/assistant", "nav.assistant"],
    ["/insights", "nav.insights"],
    ["/reports", "nav.reports"],
  ];
  for (const [prefix, key] of prefixes) {
    if (pathname.startsWith(prefix)) return key;
  }
  return "nav.dashboard";
}

export function navTitle(locale: Locale, pathname: string): string {
  return translator(locale)(navTitleKey(pathname));
}
