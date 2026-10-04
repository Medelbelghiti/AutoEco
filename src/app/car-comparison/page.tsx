import Link from "next/link";
import { MarketingShell } from "@/components/MarketingShell";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Compare Cars",
  description: "Compare two vehicles by monthly cost, annual cost, and 3-year ownership cost.",
  path: "/car-comparison",
});

export default function CarComparisonPage() {
  return (
    <MarketingShell>
      <section className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl md:text-4xl font-bold">Compare cars</h1>
        <p className="text-charcoal-600 mt-3">AutoEco lets you compare up to 5 vehicles side by side using your actual cost data.</p>
        <div className="card mt-6">
          <p className="font-semibold">How comparison works</p>
          <ol className="mt-3 space-y-2 text-sm text-charcoal-700 list-decimal pl-5">
            <li>Open your garage and select two or more vehicles.</li>
            <li>AutoEco aggregates monthly cost, annual cost, cost per km, and 3-year ownership cost for each.</li>
            <li>Estimates are based on your ACTUAL recorded expenses and clearly labeled assumptions.</li>
          </ol>
          <Link href="/signup" className="btn btn-accent mt-4">Create free account</Link>
        </div>
      </section>
    </MarketingShell>
  );
}
