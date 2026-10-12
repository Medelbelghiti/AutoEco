"use client";
import { useRouter } from "next/navigation";
import { READY_LOCALES, LOCALE_NAMES } from "@/lib/i18n";

export function LocaleSwitcher({ current, id, label }: { current: string; id?: string; label?: string }) {
  const router = useRouter();
  const onChange = async (v: string) => {
    document.cookie = `lg_locale=${v}; path=/; max-age=${60 * 60 * 24 * 365}`;
    // Update user locale if logged in
    try {
      await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: v }),
      });
    } catch {
      /* ignore */
    }
    router.refresh();
  };
  return (
    <select
      id={id}
      aria-label={label ?? "Language"}
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="select"
      style={{ minWidth: 132 }}
    >
      {READY_LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_NAMES[l]}
        </option>
      ))}
    </select>
  );
}
