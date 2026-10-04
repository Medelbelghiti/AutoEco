"use client";

/**
 * Anonymous funnel tracking.
 *
 * Deliberately minimal and dependency-free:
 *  - fires and forgets (`navigator.sendBeacon`, falling back to fetch with
 *    `keepalive`), so it never delays navigation or a click handler;
 *  - sends NO identifier of any kind — no cookie, no localStorage id, no
 *    referrer. Unique-visitor counting happens in the analytics vendor, not
 *    here;
 *  - respects an explicit opt-out flag (`localStorage.autoeco_analytics`).
 *
 * Server-side events (signup, checkout, subscription_created, …) are tracked
 * in the API routes with the userId and are unaffected by this.
 */

export type TrackableEvent =
  | "landing_view"
  | "cta_click"
  | "calculator_started"
  | "calculator_completed"
  | "pricing_view"
  | "signup_started"
  | "docs_view";

/** Opt-out switch for users who object to anonymous analytics. */
export function analyticsOptedOut(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem("autoeco_analytics") === "off";
  } catch {
    // Storage blocked (private mode): do not track.
    return true;
  }
}

export function setAnalyticsOptOut(off: boolean): void {
  try {
    if (off) window.localStorage.setItem("autoeco_analytics", "off");
    else window.localStorage.removeItem("autoeco_analytics");
  } catch {
    /* nothing we can do */
  }
}

export function track(event: TrackableEvent, path?: string): void {
  if (analyticsOptedOut()) return;

  const body = JSON.stringify({ event, path: path ?? window.location.pathname });

  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    /* fall through to fetch */
  }

  try {
    void fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}