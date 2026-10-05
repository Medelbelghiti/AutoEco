import Link from "next/link";
import { MarketingShell } from "@/components/MarketingShell";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "FAQ",
  description: "Frequently asked questions about AutoEco — vehicle cost tracking, scenarios, and the financial engine.",
  path: "/faq",
});

const FAQS = [
  {
    q: "What is AutoEco?",
    a: "A financial operating system for your car. Track fuel, maintenance, repairs, insurance and other expenses to understand what your car really costs — monthly, annually, and per kilometer.",
  },
  {
    q: "Is AutoEco a mechanic or safety diagnostic?",
    a: "No. AutoEco is strictly a financial analysis tool. We never tell you a car is safe or unsafe to drive. We never diagnose mechanical issues. We only help you understand the financial implications of ownership.",
  },
  {
    q: "Where does the data come from?",
    a: "From you. You add your vehicle, your expenses, and your fuel entries. AutoEco computes results from your real data. We never invent vehicle specifications, prices, or financial history.",
  },
  {
    q: "Do you cover every country?",
    a: "Yes — AutoEco is geography-agnostic. You choose your currency, distance unit, and fuel consumption unit. Vehicle data is added manually so there are no provider limitations.",
  },
  {
    q: "What is the Financial Twin?",
    a: "A live financial model of your vehicle. It computes your monthly cost, annual cost, cost per kilometer, total ownership cost, depreciation, and a 12-month forecast. Every output is labeled ACTUAL, ESTIMATE, or FORECAST so you know what is real and what is assumed.",
  },
  {
    q: "What are the plans?",
    a: "Free (1 vehicle), Pro ($6.99/month, up to 5 vehicles) and Pro Plus ($19.99/month, up to 50 vehicles). Receipt scanning, family sharing and API access are on the roadmap and are not sold yet.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes. New accounts get a 14-day trial with expanded limits so you can evaluate before paying.",
  },
  {
    q: "How accurate are the forecasts?",
    a: "Forecasts are based on your actual recorded expenses. They do not invent market data. The 12-month projection assumes flat monthly cost unless you opt into inflation modeling. All assumptions are shown next to every result.",
  },
  {
    q: "What about repair vs replace?",
    a: "Repair vs replace in AutoEco is a financial comparison only. We never make mechanical safety claims. The comparison shows you the projected cost of fixing your current car vs the projected cost of replacing it, with all assumptions listed.",
  },
  {
    q: "Can I export my data?",
    a: "Yes. From Settings you can request a full export and permanently delete your account at any time.",
  },
  {
    q: "Is my data shared?",
    a: "No. Your vehicle and financial data is private by default. We never share it with third parties. Stripe processes payments; we do not store payment card data.",
  },
];

export default function FaqPage() {
  return (
    <MarketingShell>
      <section className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl md:text-4xl font-bold">Frequently asked questions</h1>
        <div className="mt-8 space-y-4">
          {FAQS.map((f) => (
            <details key={f.q} className="card">
              <summary className="font-semibold cursor-pointer">{f.q}</summary>
              <p className="mt-2 text-sm text-charcoal-700">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="text-center text-sm text-charcoal-500 mt-10">
          Ready to try it? <Link href="/signup" className="underline">Create a free account</Link>.
        </p>
      </section>
    </MarketingShell>
  );
}
