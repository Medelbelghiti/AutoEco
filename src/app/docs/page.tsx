import Link from "next/link";
import { MarketingShell } from "@/components/MarketingShell";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Documentation",
  description: "Documentation for AutoEco — vehicle cost tracking, scenarios, and the financial engine.",
  path: "/docs",
});

const SECTIONS = [
  {
    title: "Quick start",
    body: [
      "Sign up and confirm your email.",
      "Add your first vehicle (Garage → Add).",
      "Add fuel and expenses. Use Quick Add to log in seconds.",
      "Open your dashboard to see monthly cost, cost/km, breakdown by category.",
      "Run a What-If to compare scenarios.",
    ],
  },
  {
    title: "Financial engine",
    body: [
      "Every number is labeled: ACTUAL (from your data), ESTIMATE (calculated from assumptions), or FORECAST (projection).",
      "Cost per kilometer is computed from total relevant spend divided by distance between first and last known odometer reading.",
      "Depreciation defaults to 20% per year straight-line. Provide a resale value in your vehicle to override.",
      "Forecast is flat monthly — no inflation assumption unless you opt in via the API.",
    ],
  },
  {
    title: "Data integrity",
    body: [
      "AutoEco never invents vehicle specifications.",
      "AutoEco never fabricates financial history.",
      "Empty states explicitly say “Not enough data yet” instead of producing fake averages.",
    ],
  },
  {
    title: "Security",
    body: [
      "Passwords are bcrypt-hashed (12 rounds).",
      "Sessions are JWT in httpOnly cookies.",
      "Every resource fetch checks ownership server-side (assertOwnership).",
      "Rate limits apply on signup and login.",
    ],
  },
  {
    title: "Coverage",
    body: [
      "Vehicle data is added manually to keep the product fully usable without external API keys.",
      "A small vehicle catalog ships by default (Toyota, Honda, BMW, Renault, etc.).",
      "Currency, distance unit and fuel consumption unit are configurable per user.",
    ],
  },
];

export default function DocsPage() {
  return (
    <MarketingShell>
      <section className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl md:text-4xl font-bold">Documentation</h1>
        <p className="text-charcoal-600 mt-3">How AutoEco works, in plain language.</p>
        <div className="mt-8 space-y-8">
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <h2 className="text-xl font-semibold">{s.title}</h2>
              <ul className="mt-2 space-y-1 text-charcoal-700 list-disc pl-5">
                {s.body.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 card">
          <p className="font-semibold">Need more help?</p>
          <p className="text-sm text-charcoal-500 mt-1">Open your dashboard and use “Ask my car's money” for instant answers from your data.</p>
          <Link href="/signup" className="btn btn-accent mt-3">Create free account</Link>
        </div>
      </section>
    </MarketingShell>
  );
}
