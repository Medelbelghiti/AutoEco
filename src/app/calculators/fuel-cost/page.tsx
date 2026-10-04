import { MarketingShell } from "@/components/MarketingShell";
import Link from "next/link";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Fuel Cost Calculator",
  description: "Estimate how much you spend on fuel per month and year.",
  path: "/calculators/fuel-cost",
});

export default function FuelCostPage() {
  return (
    <MarketingShell>
      <section className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl md:text-4xl font-bold">Fuel Cost Calculator</h1>
        <p className="text-charcoal-600 mt-2">Estimate your fuel spending.</p>
        <FuelCalculator />
        <p className="text-xs text-charcoal-500 mt-6">Want to track your actual consumption? <Link className="underline" href="/signup">Create a free AutoEco account</Link>.</p>
      </section>
    </MarketingShell>
  );
}

import { FuelCalculatorClient } from "./Calculator";
const FuelCalculator = FuelCalculatorClient;
