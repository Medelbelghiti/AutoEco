import { NextResponse } from "next/server";
import { withErrorHandling, ok } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeVehicleCost } from "@/lib/compute-cost";
import { formatMoney, projectCost, type CostSummary } from "@/lib/finance";
import { getEntitlements } from "@/lib/plans";
import { buildPeriodKey, tryConsume, type QuotaMetric } from "@/lib/quota";

interface ChatMsg { role: "system" | "user" | "assistant"; content: string; }

export const POST = withErrorHandling(async (req) => {
  const user = await requireUser();
  const body = await req.json().catch(() => ({}));
  const question = String(body?.question ?? body?.q ?? "").trim();
  if (!question) return NextResponse.json({ error: "Missing question" }, { status: 400 });

  // 1. Authoritative entitlement
  const ent = await getEntitlements(user);
  const periodKey = buildPeriodKey(new Date(), { trial: ent.isTrial, userId: user.id });
  const metric: QuotaMetric = "ai_conversations";

  // 2. Atomic quota reservation. If this returns allowed=false, no DB writes
  // happened — the request is rejected without side effects.
  const consumption = await tryConsume({
    userId: user.id,
    metric,
    periodKey,
    limit: ent.aiConversationsPerMonth,
  });

  if (!consumption.allowed) {
    return NextResponse.json({
      error: ent.aiConversationsPerMonth === 0
        ? "AI conversations are not included in your plan"
        : `Monthly AI limit reached (${ent.aiConversationsPerMonth})`,
      code: "AI_QUOTA_EXCEEDED",
    }, { status: 403 });
  }

  // 3. Now safely produce the answer. Build the answer from REAL data only.
  let facts: Record<string, unknown> = {};
  let answerText: string;
  let source: "llm" | "deterministic" | "no-data" | "mixed-currency" = "deterministic";

  const vehicles = await db.vehicle.findMany({ where: { userId: user.id, archived: false } });
  if (vehicles.length === 0) {
    answerText = "You have not added any vehicles yet. Add one to start asking questions.";
    source = "no-data";
  } else {
    const vehicle = vehicles.find((v) => v.isPrimary) ?? vehicles[0];
    const result = await computeVehicleCost(user.id, vehicle.id);
    if (!result.ok) {
      answerText = "I can't compute totals right now because your expenses and fuel entries use multiple currencies. Use a single currency for this vehicle and try again.";
      source = "mixed-currency";
    } else {
      const summary: CostSummary = result.summary;
      const currency = summary.baseCurrency;
      const forecast12 = projectCost(summary, 12);
      facts = {
        vehicle: `${vehicle.year} ${vehicle.brand} ${vehicle.model}`,
        currency,
        monthsOfData: summary.monthsOfData,
        totalSpent: formatMoney(summary.totalSpent, currency),
        monthlyAverage: formatMoney(summary.monthlyAverage, currency),
        annualEstimate: formatMoney(summary.annualEstimate, currency),
        costPerUnit: summary.costPerKm != null ? `${formatMoney(summary.costPerKm, currency)} per ${vehicle.currentMileageUnit ?? "km"}` : "not enough data",
        totalFuel: formatMoney(summary.totalFuel, currency),
        totalMaintenance: formatMoney(summary.totalMaintenance, currency),
        totalInsurance: formatMoney(summary.totalInsurance, currency),
        forecast12mo: formatMoney(forecast12.total, currency),
        forecastAssumptions: forecast12.assumptions,
        breakdownByCategory: summary.breakdown.map((b) => `${b.category}=${formatMoney(b.amount, currency)} (${b.percent}%)`).join(", "),
      };

      const apiKey = process.env.OPENAI_API_KEY;
      if (apiKey) {
        try {
          answerText = await callLlm(apiKey, question, facts);
          source = "llm";
        } catch (e) {
          // Deterministic fallback when LLM fails. Quota already consumed
          // — that is the documented product decision (failed-call users
          // can retry without burning an extra quota unit because the
          // fallback still produced a useful answer).
          console.error("AI LLM failed", e);
          answerText = deterministicAnswer(question, facts, summary, currency);
        }
      } else {
        answerText = deterministicAnswer(question, facts, summary, currency);
      }
    }
  }

  // 4. Persist conversation + user message + assistant message. This is a
  //    side effect but cannot affect the quota claim — if it fails, we
  //    intentionally keep the reservation (the user consumed AI capacity).
  try {
    await persistConversation(user.id, question, answerText, source);
  } catch (e) {
    console.error("Failed to persist AI conversation", e);
  }

  return ok({ answer: answerText, source, facts });
});

async function persistConversation(
  userId: string,
  userMessage: string,
  assistantMessage: string,
  source: string
): Promise<void> {
  const conv = await db.conversation.create({ data: { userId } });
  await db.conversationMessage.createMany({
    data: [
      { conversationId: conv.id, role: "user", content: userMessage },
      { conversationId: conv.id, role: "assistant", content: assistantMessage, tokenCount: source === "llm" ? 1 : 0 },
    ],
  });
}

async function callLlm(apiKey: string, question: string, facts: Record<string, unknown>): Promise<string> {
  const sys = "You are the AutoEco financial assistant. Answer using ONLY the JSON facts provided. " +
    "Never invent numbers. Never fabricate vehicle specifications, mileage, expenses, or forecasts. " +
    "If facts are insufficient respond: \"I don't have enough data to calculate that yet.\" " +
    "Never diagnose mechanical safety, claim a car is safe or unsafe, or recommend driving decisions. " +
    "Label ACTUAL vs ESTIMATE vs FORECAST clearly.";
  const user = `FACTS (JSON): ${JSON.stringify(facts)}\n\nQUESTION: ${question}`;
  const messages: ChatMsg[] = [{ role: "system", content: sys }, { role: "user", content: user }];
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? "gpt-4o-mini", messages, temperature: 0.2, max_tokens: 400 }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("Empty LLM response");
  return text.trim();
}

function deterministicAnswer(q: string, facts: Record<string, any>, summary: CostSummary, currency: string): string {
  const ql = q.toLowerCase();
  if (facts.monthsOfData === 0) return "I don't have enough data to calculate that yet.";
  if (contains(ql, ["cost per km", "per kilometer", "per km"])) {
    if (summary.costPerKm == null) return "I don't have enough distance data to compute cost per km yet.";
    return `Your cost per ${summary.totalDistance ? "" : ""} is approximately ${facts.costPerUnit} (ACTUAL).`;
  }
  if (contains(ql, ["this month", "monthly", "spent this month"])) return `Based on your last ${facts.monthsOfData} months, your average monthly cost is ${facts.monthlyAverage} (ACTUAL).`;
  if (contains(ql, ["fuel", "essence", "carburant"])) return `Total recorded fuel spending: ${facts.totalFuel} (ACTUAL).`;
  if (contains(ql, ["maintenance", "entretien"])) return `Total recorded maintenance: ${facts.totalMaintenance} (ACTUAL).`;
  if (contains(ql, ["insurance", "assurance"])) return `Total recorded insurance / financing / tax: ${facts.totalInsurance} (ACTUAL).`;
  if (contains(ql, ["most expensive", "biggest", "largest"])) {
    const top = summary.breakdown[0];
    if (!top) return "No data yet.";
    return `Your largest spending category is ${top.category} (${top.percent}% of recorded spending).`;
  }
  if (contains(ql, ["annual", "year", "annuel"])) return `Your estimated annual cost is ${facts.annualEstimate} (ACTUAL). 12-month forecast (FORECAST, flat): ${facts.forecast12mo}.`;
  if (contains(ql, ["forecast", "next year", "12 months", "future"])) return `12-month flat forecast: ${facts.forecast12mo}. Assumptions: ${facts.forecastAssumptions.join("; ")}.`;
  if (contains(ql, ["fuel rise", "fuel +", "fuel up", "fuel increase"])) {
    const m = ql.match(/(\d+)\s*%/);
    const pct = m ? Number(m[1]) : 15;
    const newFuel = summary.totalFuel * (1 + pct / 100);
    return `If fuel rises ${pct}%, your monthly fuel cost increases by approximately ${formatMoney((newFuel - summary.totalFuel) / Math.max(1, summary.monthsOfData), currency)} (ESTIMATE). Your new projected monthly cost would be ${formatMoney(summary.monthlyAverage + (newFuel - summary.totalFuel) / Math.max(1, summary.monthsOfData), currency)}.`;
  }
  if (contains(ql, ["total", "spent", "depenses"])) return `Total recorded spending: ${facts.totalSpent} across ${facts.monthsOfData} months (ACTUAL).`;
  return `I can answer questions about monthly cost, cost per km, fuel, maintenance, insurance, total spending, and 12-month forecast.`;
}

function contains(s: string, keys: string[]): boolean { return keys.some((k) => s.includes(k)); }
