"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { track, type TrackableEvent } from "@/lib/track-client";

/**
 * A `next/link` that records an anonymous click event before navigating.
 *
 * Tracking happens in the click handler and never blocks navigation — the
 * beacon is fire-and-forget, so a blocked or failed request cannot stop the
 * user reaching the calculator, pricing or signup.
 */
type TrackedLinkProps = { analyticsEvent: TrackableEvent } & ComponentProps<typeof Link>;

export function TrackedLink({
  analyticsEvent,
  children,
  onClick,
  ...props
}: TrackedLinkProps) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    try {
      track(analyticsEvent);
    } catch {
      /* never break navigation */
    }
    onClick?.(e);
  };

  return (
    <Link {...props} onClick={handleClick}>
      {children}
    </Link>
  );
}