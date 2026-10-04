import Link from "next/link";
import { cookies } from "next/headers";
import {
  ArrowRight,
  Car,
  Download,
  FileText,
  Fuel,
  LineChart,
  MessageSquare,
  Receipt,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingDown,
  Wrench,
  Check,
  X as XIcon,
} from "lucide-react";
import { MarketingShell } from "@/components/MarketingShell";
import { TrackEvent } from "@/components/TrackEvent";
import { TrackedLink } from "@/components/TrackedLink";
import { DEFAULT_LOCALE, isLocale, type Locale, translate } from "@/lib/i18n";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "AutoEco — Track & Calculate Your True Car Ownership Cost",
  description:
    "Track fuel, maintenance, repairs, insurance and other vehicle expenses. Understand your true cost per month and kilometer and forecast future costs.",
  path: "/",
  keywords: [
    "car ownership cost calculator",
    "true cost of owning a car",
    "car expense tracker",
    "vehicle cost calculator",
    "cost per kilometer",
    "car maintenance tracker",
    "car cost per mile",
  ],
});

/**
 * Ask Your Car examples.
 *
 * Every one of these is answerable by the CURRENT backend
 * (`src/app/api/ai/route.ts` → `deterministicAnswer`) from data the user
 * records. We deliberately do not advertise per-month or per-vehicle
 * questions the engine cannot actually answer.
 *
 * Order must stay aligned with the locale files (`ask.q1` … `ask.q6`).
 */
const ASK_EXAMPLE_KEYS = [
  "ask.q1",
  "ask.q2",
  "ask.q3",
  "ask.q4",
  "ask.q5",
  "ask.q6",
];

export default function HomePage() {
  const cookie = cookies().get("lg_locale")?.value;
  const locale: Locale = isLocale(cookie) ? cookie : DEFAULT_LOCALE;
  const t = (k: string) => translate(locale, k);

  return (
    <MarketingShell>
      <TrackEvent event="landing_view" onceKey="landing" />
      {/* ------------------------------- Hero ------------------------------- */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-emerald-50 via-white to-charcoal-50 dark:from-emerald-950/20 dark:via-charcoal-950 dark:to-charcoal-900" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-16 md:pt-20 md:pb-24 grid md:grid-cols-2 gap-10 md:gap-12 items-center">
          <div>
            <span className="badge badge-ok mb-4">
              <Sparkles className="w-3 h-3 mr-1" aria-hidden="true" /> {t("hero.badge")}
            </span>
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05]">
              {t("hero.title")}
            </h1>
            <p className="mt-5 text-lg text-charcoal-600 dark:text-charcoal-300 max-w-xl">
              {t("hero.subtitle")}
            </p>

            {/* Primary CTA = value first, no signup required. */}
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <TrackedLink
                analyticsEvent="cta_click"
                href="/calculators/car-cost"
                className="btn btn-accent px-6 py-3 text-base"
              >
                {t("hero.cta_primary")} <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </TrackedLink>
              <a href="#how-it-works" className="btn btn-secondary px-6 py-3 text-base">
                {t("hero.cta_secondary")}
              </a>
            </div>
            <p className="mt-4 text-sm text-charcoal-600 dark:text-charcoal-400">
              {t("hero.micro")}
            </p>
            <p className="mt-2 text-xs text-charcoal-500 max-w-lg">{t("hero.disclaimer")}</p>
          </div>
          <div className="relative">
            <FinancialTwinPreview t={t} />
          </div>
        </div>
      </section>

      {/* --------------------------- How it works --------------------------- */}
      <section id="how-it-works" aria-labelledby="how-heading" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 scroll-mt-20">
        <h2 id="how-heading" className="text-2xl md:text-3xl font-bold text-center">{t("how.title")}</h2>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { n: 1, icon: Car, t: t("how.s1.t"), d: t("how.s1.d"), href: "/signup" },
            { n: 2, icon: Fuel, t: t("how.s2.t"), d: t("how.s2.d"), href: "/signup" },
            { n: 3, icon: Receipt, t: t("how.s3.t"), d: t("how.s3.d"), href: "/features" },
            { n: 4, icon: LineChart, t: t("how.s4.t"), d: t("how.s4.d"), href: "/features" },
          ].map((s) => (
            <div key={s.n} className="card flex flex-col">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-charcoal-900 text-white dark:bg-white dark:text-charcoal-900 inline-flex items-center justify-center text-sm font-bold">
                  {s.n}
                </span>
                <s.icon className="w-5 h-5 text-charcoal-400" aria-hidden="true" />
              </div>
              <p className="mt-3 font-semibold">{s.t}</p>
              <p className="text-sm text-charcoal-500 mt-1 flex-1">{s.d}</p>
              <Link href={s.href} className="text-sm text-emerald-700 dark:text-emerald-400 underline mt-3">
                {t("how.learn_more")}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------ Features ---------------------------- */}
      <section aria-labelledby="features-heading" className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <h2 id="features-heading" className="sr-only">{t("features.heading")}</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureCard icon={TrendingDown} title={t("features.cost.title")} desc={t("features.cost.desc")} />
          <FeatureCard icon={Fuel} title={t("features.fuel.title")} desc={t("features.fuel.desc")} />
          <FeatureCard icon={LineChart} title={t("features.twin.title")} desc={t("features.twin.desc")} />
          <FeatureCard icon={FileText} title={t("features.reports.title")} desc={t("features.reports.desc")} />
          <FeatureCard icon={Sparkles} title={t("features.ai.title")} desc={t("features.ai.desc")} />
          <FeatureCard icon={ShieldCheck} title={t("features.privacy.title")} desc={t("features.privacy.desc")} />
        </div>
        <p className="text-center mt-6">
          <Link href="/features" className="btn btn-secondary">
            {t("features.all")}
          </Link>
        </p>
      </section>

      {/* --------------------------- Ask Your Car --------------------------- */}
      <section aria-labelledby="ask-heading" className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <span className="badge badge-ok">
              <MessageSquare className="w-3 h-3 mr-1" aria-hidden="true" /> {t("ask.name")}
            </span>
            <h2 id="ask-heading" className="text-2xl md:text-3xl font-bold mt-3">{t("ask.title")}</h2>
            <p className="mt-3 text-charcoal-600 dark:text-charcoal-300 max-w-xl">{t("ask.subtitle")}</p>
            <p className="mt-4 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {t("ask.badge")}
            </p>
            <Link href="/pricing" className="btn btn-primary mt-4">
              {t("ask.cta")} <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="card shadow-elevated">
            <p className="label">{t("ask.examples_title")}</p>
            <ul className="mt-3 space-y-2">
              {ASK_EXAMPLE_KEYS.map((k) => (
                <li key={k} className="flex items-start gap-2 text-sm">
                  <MessageSquare className="w-4 h-4 mt-0.5 shrink-0 text-charcoal-400" aria-hidden="true" />
                  <span>&ldquo;{t(k)}&rdquo;</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-charcoal-500 border-t border-charcoal-200 dark:border-charcoal-700 pt-3">
              {t("ask.examples_note")}
            </p>
          </div>
        </div>
      </section>

      {/* -------------------------- Differentiation ------------------------- */}
      <section aria-labelledby="diff-heading" className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
        <div className="text-center">
          <h2 id="diff-heading" className="text-2xl md:text-3xl font-bold">{t("diff.title")}</h2>
          <p className="mt-3 text-charcoal-600 dark:text-charcoal-300 max-w-2xl mx-auto">
            {t("diff.subtitle")}
          </p>
        </div>
        <div className="mt-8 grid md:grid-cols-2 gap-4">
          <div className="card border-charcoal-200 dark:border-charcoal-700">
            <p className="font-semibold text-charcoal-500">{t("diff.traditional.title")}</p>
            <ul className="mt-3 space-y-2">
              {[
                "diff.traditional.1",
                "diff.traditional.2",
                "diff.traditional.3",
                "diff.traditional.4",
                "diff.traditional.5",
              ].map((k) => (
                <li key={k} className="flex items-start gap-2 text-sm text-charcoal-600 dark:text-charcoal-400">
                  <XIcon className="w-4 h-4 mt-0.5 shrink-0 text-charcoal-400" aria-hidden="true" />
                  <span>{t(k)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card border-emerald-500 bg-emerald-50/60 dark:bg-emerald-900/10">
            <p className="font-semibold text-emerald-800 dark:text-emerald-300">{t("diff.autoeco.title")}</p>
            <ul className="mt-3 space-y-2">
              {[
                "diff.autoeco.1",
                "diff.autoeco.2",
                "diff.autoeco.3",
                "diff.autoeco.4",
                "diff.autoeco.5",
                "diff.autoeco.6",
              ].map((k) => (
                <li key={k} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                  <span>{t(k)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-4 text-sm text-charcoal-600 dark:text-charcoal-300 text-center">{t("diff.note")}</p>
      </section>

      {/* ------------------------------ Promise ----------------------------- */}
      <section aria-labelledby="promise-heading" className="max-w-4xl mx-auto px-4 sm:px-6 py-14 text-center">
        <h2 id="promise-heading" className="text-2xl md:text-3xl font-bold">{t("promise.title")}</h2>
        <p className="mt-4 text-charcoal-600 dark:text-charcoal-300">{t("promise.body")}</p>
      </section>

      {/* ------------------------- Trust & transparency --------------------- */}
      <section aria-labelledby="trust-heading" className="max-w-5xl mx-auto px-4 sm:px-6 pb-16">
        <div className="text-center">
          <h2 id="trust-heading" className="text-2xl md:text-3xl font-bold">{t("trust.title")}</h2>
          <p className="mt-3 text-charcoal-600 dark:text-charcoal-300 max-w-2xl mx-auto">
            {t("trust.subtitle")}
          </p>
        </div>
        <div className="mt-8 grid sm:grid-cols-2 gap-4">
          <TrustCard icon={Download} title={t("trust.1.t")} desc={t("trust.1.d")} />
          <TrustCard icon={Trash2} title={t("trust.2.t")} desc={t("trust.2.d")} />
          <TrustCard icon={ShieldCheck} title={t("trust.3.t")} desc={t("trust.3.d")} />
          <TrustCard icon={Wrench} title={t("trust.4.t")} desc={t("trust.4.d")} />
        </div>
        <p className="mt-6 text-center text-sm">
          <Link href="/privacy" className="underline">{t("trust.privacy_link")}</Link>
        </p>
      </section>

      {/* -------------------------------- CTA ------------------------------- */}
      <section aria-labelledby="cta-heading" className="max-w-4xl mx-auto px-4 sm:px-6 pb-16">
        <div className="card bg-charcoal-900 text-white border-0 dark:bg-emerald-700/15 dark:text-white">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <p id="cta-heading" className="text-xl font-bold">{t("cta.title")}</p>
              <p className="text-charcoal-300 mt-1">{t("cta.body")}</p>
              <p className="text-charcoal-400 mt-1 text-xs">{t("cta.secondary")}</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto shrink-0">
              <TrackedLink
                analyticsEvent="cta_click"
                href="/signup"
                className="btn btn-accent px-6 py-3 text-base whitespace-nowrap"
              >
                {t("cta.button")} <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </TrackedLink>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

function FeatureCard({ icon: Icon, title, desc }: { icon: typeof TrendingDown; title: string; desc: string }) {
  return (
    <div className="card">
      <Icon className="w-6 h-6 text-emerald-600" aria-hidden="true" />
      <p className="mt-3 font-semibold">{title}</p>
      <p className="text-sm text-charcoal-500 mt-1">{desc}</p>
    </div>
  );
}

function TrustCard({ icon: Icon, title, desc }: { icon: typeof Download; title: string; desc: string }) {
  return (
    <div className="card">
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" aria-hidden="true" />
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-charcoal-500 mt-1">{desc}</p>
        </div>
      </div>
    </div>
  );
}

function FinancialTwinPreview({ t }: { t: (k: string) => string }) {
  return (
    <div className="card shadow-elevated">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="label">{t("preview.title")}</p>
          <p className="font-semibold mt-1">2021 BMW X5 xDrive40i</p>
        </div>
        <span className="badge badge-ok shrink-0">{t("preview.sample")}</span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Stat label={t("preview.monthly")} value="$487" />
        <Stat label={t("preview.per_km")} value="$0.31" />
        <Stat label={t("preview.annual")} value="$5,844" />
        <Stat label={t("preview.forecast")} value="$5,920" accent />
      </div>
      <div className="mt-5">
        <p className="text-xs text-charcoal-500 mb-2">{t("preview.where")}</p>
        <Bar pct={42} label={t("preview.fuel")} color="bg-emerald-500" t={t} />
        <Bar pct={28} label={t("preview.maintenance")} color="bg-charcoal-700 dark:bg-charcoal-400" t={t} />
        <Bar pct={18} label={t("preview.insurance")} color="bg-amber-500" t={t} />
        <Bar pct={12} label={t("preview.other")} color="bg-charcoal-400" t={t} />
      </div>
      <p className="mt-4 text-[11px] text-charcoal-500">{t("preview.note")}</p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`p-3 rounded-lg ${accent ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-charcoal-50 dark:bg-charcoal-800/60"}`}>
      <p className="text-xs text-charcoal-500">{label}</p>
      <p className={`text-xl font-bold mt-0.5 tabular-nums ${accent ? "text-emerald-700 dark:text-emerald-300" : ""}`}>{value}</p>
    </div>
  );
}

function Bar({ pct, label, color, t }: { pct: number; label: string; color: string; t: (k: string) => string }) {
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-charcoal-600 dark:text-charcoal-300">{label}</span>
        <span className="text-charcoal-500">{pct}%</span>
      </div>
      <div
        className="progress"
        role="img"
        aria-label={`${label}: ${pct}% ${t("preview.of_total")}`}
      >
        <span className={color} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}