import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEntitlements } from "@/lib/plans";
import { SettingsForms } from "./Forms";

export default async function SettingsPage() {
  const user = await requireUser();
  const ent = await getEntitlements(user);
  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="mt-6 space-y-6">
        <div className="card">
          <p className="font-semibold">Profile</p>
          <SettingsForms.Profile name={user.name ?? ""} email={user.email} locale={user.locale} />
        </div>
        <div className="card">
          <p className="font-semibold">Preferences</p>
          <SettingsForms.Preferences userId={user.id} currency={user.currency} distanceUnit={user.distanceUnit} fuelUnit={user.fuelUnit} />
        </div>
        <div className="card">
          <p className="font-semibold">Mileage deduction rate</p>
          <SettingsForms.DeductionRate
            rateCents={user.mileageDeductionRateCents === null ? "" : (user.mileageDeductionRateCents / 100).toString()}
            currency={user.mileageDeductionCurrency ?? user.currency}
            unit={user.mileageDeductionUnit ?? user.distanceUnit}
          />
        </div>
        <div className="card">
          <p className="font-semibold">Security</p>
          <SettingsForms.ChangePassword />
        </div>
        <div className="card">
          <p className="font-semibold">Subscription</p>
          <p className="text-sm text-charcoal-500 mt-1">Plan: <strong>{ent.planName}</strong> ({ent.subscriptionStatus ?? "free"})</p>
          {ent.isTrial && ent.trialEndsAt && <p className="text-sm text-amber-700 mt-1">Trial ends {ent.trialEndsAt.toISOString().slice(0, 10)}</p>}
          <div className="flex gap-2 mt-3">
            <Link href="/settings/billing" className="btn btn-primary">Manage billing</Link>
            <Link href="/pricing" className="btn btn-secondary">View plans</Link>
          </div>
        </div>
<div className="card">
          <p className="font-semibold">Your data</p>
          <p className="text-sm text-charcoal-500 mt-1">Export everything you have entered as CSV.</p>
          <SettingsForms.ExportData />
        </div>
        <div className="card border-rose-200">
          <p className="font-semibold text-rose-700">Danger zone</p>
          <SettingsForms.DeleteAccount />
        </div>
      </div>
    </div>
  );
}
