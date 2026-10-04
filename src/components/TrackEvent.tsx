"use client";

import { useEffect } from "react";
import { track, type TrackableEvent } from "@/lib/track-client";

/**
 * Fire an anonymous analytics event once, when the component mounts.
 *
 * Renders nothing. Used in server components that cannot call the tracking
 * helper directly (the helper touches `navigator`).
 *
 * `onceKey` should be unique per page so navigating between pages records a
 * view each time rather than only on the first mount.
 */
export function TrackEvent({ event, onceKey }: { event: TrackableEvent; onceKey?: string }) {
  useEffect(() => {
    track(event);
    // `onceKey` participates in the dependency list so callers can force a
    // re-fire when the route changes underneath a reused component.
  }, [event, onceKey]);

  return null;
}