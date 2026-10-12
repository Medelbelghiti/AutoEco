"use client";

import { useState } from "react";
import { Sparkles, Send } from "lucide-react";
import { useT } from "@/components/LocaleProvider";

/**
 * Ask My Car's Money — V1 grounded-answer engine.
 * No AI is invoked. The answer is computed deterministically from the
 * user's actual expenses + fuel entries + vehicle data, so we never
 * hallucinate financial facts.
 *
 * If information is missing, we say so explicitly.
 */
export default function AssistantPage() {
  const t = useT();
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  const ask = async (q?: string) => {
    const question = (q ?? input).trim();
    if (!question) return;
    setInput(question);
    setLoading(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const j = await res.json();
      setData(j);
      setAnswer(j.answer ?? t("assistant.no_answer"));
    } catch {
      setAnswer(t("common.failed"));
    }
    setLoading(false);
  };

  const suggestions = [
    t("assistant.s1"),
    t("assistant.s2"),
    t("assistant.s3"),
    t("assistant.s4"),
    t("assistant.s5"),
  ];

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-emerald-600" />
        <h1 className="text-2xl font-bold">{t("assistant.title")}</h1>
      </div>
      <p className="text-sm text-charcoal-500 mt-1">{t("assistant.subtitle")}</p>

      <div className="card mt-6">
        <div className="flex gap-2">
          <input
            className="input"
            placeholder={t("assistant.placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
          />
          <button className="btn btn-accent" disabled={loading} onClick={() => ask()}>
            <Send className="w-4 h-4" /> {t("assistant.ask")}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} className="btn btn-ghost text-xs" onClick={() => ask(s)}>{s}</button>
          ))}
        </div>
      </div>

      {loading && <div className="card mt-4 text-sm text-charcoal-500">{t("assistant.thinking")}</div>}

      {answer && (
        <div className="card mt-4">
          <p className="text-base">{answer}</p>
          {data?.sources && data.sources.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-charcoal-500">
              {data.sources.map((s: string, i: number) => <li key={i}>• {s}</li>)}
            </ul>
          )}
          {data?.vehicleId && (
            <p className="text-xs text-charcoal-500 mt-3">{t("assistant.based_on", { id: data.vehicleId })}</p>
          )}
        </div>
      )}
    </div>
  );
}