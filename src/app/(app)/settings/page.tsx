import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { Profile, Preferences, DeductionRate, ChangePassword, ExportData, DeleteAccount } from "./Forms";
import { getLocale, getT } from "@/lib/server-i18n";
import { formatDate, translateEnum } from "@/lib/i18n";

export default async function SettingsPage() {
  const user = await requireUser();
  const ent = await getEntitlements(user);
  const locale = getLocale();
  const t = getT();
  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
      <div className="mt-6 space-y-6">
        <div className="card">
          <p className="font-semibold">{t("settings.profile")}</p>
          <Profile name={user.name ?? ""} email={user.email} locale={user.locale} />
        </div>
        <div className="card">
          <p className="font-semibold">{t("settings.preferences")}</p>
          <Preferences userId={user.id} currency={user.currency} distanceUnit={user.distanceUnit} fuelUnit={user.fuelUnit} locale={locale} />
        </div>
        <div className="card">
          <p className="font-semibold">{t("settings.deduction")}</p>
          <DeductionRate
            rateCents={user.mileageDeductionRateCents === null ? "" : (user.mileageDeductionRateCents / 100).toString()}
            currency={user.mileageDeductionCurrency ?? user.currency}
            unit={user.mileageDeductionUnit ?? user.distanceUnit}
            locale={locale}
          />
        </div>
        <div className="card">
          <p className="font-semibold">{t("settings.security")}</p>
          <ChangePassword locale={locale} />
        </div>
        <div className="card">
          <p className="font-semibold">{t("settings.subscription")}</p>
          <p className="text-sm text-charcoal-500 mt-1">{t("settings.plan")}: <strong>{ent.planName}</strong> ({translateEnum(t, "status.", ent.subscriptionStatus ?? "free")})</p>
          {ent.isTrial && ent.trialEndsAt && <p className="text-sm text-amber-700 mt-1">{t("settings.trial_ends", { date: formatDate(locale, ent.trialEndsAt) })}</p>}
          <div className="flex gap-2 mt-3">
            <Link href="/settings/billing" className="btn btn-primary">{t("settings.manage_billing")}</Link>
            <Link href="/pricing" className="btn btn-secondary">{t("settings.view_plans")}</Link>
          </div>
        </div>
<div className="card">
          <p className="font-semibold">{t("settings.your_data")}</p>
          <p className="text-sm text-charcoal-500 mt-1">{t("settings.export_body")}</p>
          <ExportData locale={locale} />
        </div>
        <div className="card border-rose-200">
          <p className="font-semibold text-rose-700">{t("settings.danger")}</p>
          <DeleteAccount locale={locale} />
        </div>
      </div>
    </div>
  );
}
