import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketingShell } from "@/components/MarketingShell";
import { CarCostCalculator } from "./Calculator";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Car Cost Calculator — True Cost of Owning a Car",
  description:
    "Free car ownership cost calculator. Work out your real monthly and annual cost, cost per kilometer, and the share spent on fuel, insurance, maintenance, depreciation, parking and tolls.",
  path: "/calculators/car-cost",
});

const FAQ = [
  {
    q: "What is the true cost of owning a car?",
    a: "The true cost is everything you pay to keep the car on the road, not just fuel: insurance, maintenance and repairs, tyres, road tax, parking, tolls, and the money the car loses in value while you own it. Add it all up and divide by 12 for a monthly figure, and by the distance you drive for a cost per kilometer.",
  },
  {
    q: "How is cost per kilometer calculated?",
    a: "Total annual cost divided by total annual distance. This is the number that makes cars comparable: it tells you what one kilometer of driving actually costs you in money.",
  },
  {
    q: "Should depreciation be included?",
    a: "Yes. A car that cost 20,000 and is worth 13,000 in three years has cost 7,000 in depreciation regardless of what the bank pays you. Excluding it makes almost every car look cheap.",
  },
  {
    q: "Why does my fuel cost jump around?",
    a: "Fuel spend depends on distance, consumption and the price at the pump that week. AutoEco tracks consumption from your full-tank entries so a change in fuel cost can be attributed to distance, to how you drive, or to the price itself.",
  },
];

export default function CarCostPage() {
  return (
    <MarketingShell>
      <article className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <header>
          <p className="label">Free tool · no signup required</p>
          <h1 className="text-3xl md:text-4xl font-extrabold mt-2">Car cost calculator</h1>
          <p className="mt-3 text-charcoal-600 dark:text-charcoal-300 max-w-2xl">
            Find out what your car really costs you each month, each year and each kilometer. Enter
            your own numbers — the calculator shows exactly how every figure is derived.
          </p>
        </header>

        <CarCostCalculator />

        <section className="card mt-10 border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/10">
          <h2 className="text-lg font-bold">This is an estimate. AutoEco is what makes it real.</h2>
          <p className="text-sm text-charcoal-600 dark:text-charcoal-300 mt-2">
            You just typed in guesses. AutoEco replaces guesses with facts: it tracks every fuel fill
            and every expense you log, works out your cost per kilometer from real distance, and
            forecasts what the next 12 months will cost — then tells you exactly which category is
            driving the number.
          </p>
          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <Link href="/signup" className="btn btn-accent">
              Track my real costs — free <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/features" className="btn btn-secondary">
              See what AutoEco does
            </Link>
          </div>
          <p className="text-xs text-charcoal-500 mt-3">
            Free plan, no credit card. You can export or delete everything you enter at any time.
          </p>
        </section>

        <section className="mt-12" aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="text-2xl font-bold">
            Car ownership cost questions
          </h2>
          <div className="mt-4 space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="card">
                <summary className="font-semibold cursor-pointer select-none">{f.q}</summary>
                <p className="text-sm text-charcoal-600 dark:text-charcoal-300 mt-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <nav aria-label="Other free calculators" className="mt-10">
          <h2 className="text-sm font-semibold text-charcoal-500">Other free calculators</h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            <li><Link href="/calculators/fuel-cost" className="btn btn-secondary text-sm">Fuel cost</Link></li>
            <li><Link href="/calculators/depreciation" className="btn btn-secondary text-sm">Depreciation</Link></li>
            <li><Link href="/calculators/ev-vs-gas" className="btn btn-secondary text-sm">EV vs gas</Link></li>
            <li><Link href="/calculators/repair-vs-replace" className="btn btn-secondary text-sm">Repair vs replace</Link></li>
          </ul>
        </nav>
      </article>
    </MarketingShell>
  );
}