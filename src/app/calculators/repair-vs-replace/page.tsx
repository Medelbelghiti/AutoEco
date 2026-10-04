import { MarketingShell } from "@/components/MarketingShell";
import Link from "next/link";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Repair vs Replace Calculator",
  description: "Financial comparison only. Not mechanical advice.",
  path: "/calculators/repair-vs-replace",
});

export default function RepairVsReplacePage() {
  return (
    <MarketingShell>
      <section className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl md:text-4xl font-bold">Repair vs Replace (Financial)</h1>
        <p className="text-charcoal-600 mt-2">AutoEco is not a mechanical diagnostic service. Compare the financial implications only.</p>
        <div className="card mt-6">
          <p className="font-semibold mb-3">How to think about it</p>
          <ol className="list-decimal pl-5 text-sm space-y-2 text-charcoal-700">
            <li>Estimate the cost of the repair.</li>
            <li>Estimate how many months you plan to keep the car.</li>
            <li>Estimate your monthly operating cost.</li>
            <li>Estimate the resale value of your car today and the price of a replacement.</li>
            <li>Compare total cost of (keep + repair) vs (buy + run).</li>
          </ol>
          <p className="text-sm text-charcoal-500 mt-4">For personalized numbers based on your actual vehicle, sign in to AutoEco and run a What-If scenario.</p>
          <Link href="/signup" className="btn btn-accent mt-4">Create free account</Link>
        </div>
      </section>
    </MarketingShell>
  );
}
