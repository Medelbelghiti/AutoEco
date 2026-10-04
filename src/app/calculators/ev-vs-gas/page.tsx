import { MarketingShell } from "@/components/MarketingShell";
import Link from "next/link";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "EV vs Gas Calculator",
  description: "Quick comparison of EV vs gasoline running cost.",
  path: "/calculators/ev-vs-gas",
});

export default function EvVsGasPage() {
  return (
    <MarketingShell>
      <section className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl md:text-4xl font-bold">EV vs Gasoline (cost-per-km)</h1>
        <p className="text-charcoal-600 mt-2">Compare running cost, not purchase price.</p>
        <div className="card mt-6 grid md:grid-cols-2 gap-3">
          <div>
            <p className="font-semibold">Gasoline</p>
            <p className="text-sm text-charcoal-500 mt-1">Cost/km = (L_per_100km / 100) x fuel_price</p>
            <p className="text-sm">Example: 7 L/100km x $1.50/L = <strong>$0.105/km</strong></p>
          </div>
          <div>
            <p className="font-semibold">Electric</p>
            <p className="text-sm text-charcoal-500 mt-1">Cost/km = (kWh_per_100km / 100) x electricity_price</p>
            <p className="text-sm">Example: 15 kWh/100km x $0.15/kWh = <strong>$0.0225/km</strong></p>
          </div>
        </div>
        <p className="text-xs text-charcoal-500 mt-6">Estimate only. For personalized numbers, <Link className="underline" href="/signup">track your actual usage</Link>.</p>
      </section>
    </MarketingShell>
  );
}
