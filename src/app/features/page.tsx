import Link from "next/link";
import { MarketingShell } from "@/components/MarketingShell";
import { Car, Fuel, Receipt, LineChart, FileText, Sparkles, ShieldCheck, Calculator, GitCompare, Wrench } from "lucide-react";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Features",
  description: "Everything AutoEco does to help you understand what your car really costs.",
  path: "/features",
});

const FEATURES = [
  { icon: Car, title: "Garage", desc: "Track one or many vehicles. Manual entry, no external lookup required." },
  { icon: Receipt, title: "Expense tracking", desc: "14 categories: fuel, maintenance, repair, insurance, tax, tires, parking, tolls, charging, more." },
  { icon: Fuel, title: "Fuel tracking", desc: "Liters, kWh (EV), automatic consumption (L/100km) when you log full tanks." },
  { icon: LineChart, title: "Financial Twin", desc: "A financial model of your vehicle: monthly cost, annual cost, cost per km, total ownership cost." },
  { icon: GitCompare, title: "What-If scenarios", desc: "Compare keeping vs replacing. Fuel price changes. Horizon simulations." },
  { icon: Sparkles, title: "Ask My Car's Money", desc: "Grounded Q&A — answers are computed from your actual data. No hallucinated numbers." },
  { icon: Calculator, title: "Public calculators", desc: "Car-cost, fuel-cost, depreciation, EV vs gas, repair-vs-replace — free to use, no signup required." },
  { icon: FileText, title: "Reports", desc: "Owner-ready cost-of-ownership report based on your real numbers." },
  { icon: ShieldCheck, title: "Privacy", desc: "Your vehicle and financial data is private by default. Export or delete anytime." },
  { icon: Wrench, title: "No mechanical advice", desc: "AutoEco is a financial analysis tool. We never claim a car is safe or unsafe." },
];

export default function FeaturesPage() {
  return (
    <MarketingShell>
      <section className="max-w-5xl mx-auto px-6 py-16">
        <h1 className="text-3xl md:text-4xl font-bold text-center">Features</h1>
        <p className="text-center mt-3 text-charcoal-600 max-w-2xl mx-auto">
          AutoEco is a financial operating system for your car. Everything we ship serves one promise: know what your car really costs.
        </p>
        <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card">
              <f.icon className="w-6 h-6 text-emerald-600" />
              <p className="mt-3 font-semibold">{f.title}</p>
              <p className="text-sm text-charcoal-500 mt-1">{f.desc}</p>
            </div>
          ))}
        </div>
        <p className="text-center mt-10">
          <Link href="/signup" className="btn btn-accent px-6 py-3">Start your free garage</Link>
        </p>
      </section>
    </MarketingShell>
  );
}
