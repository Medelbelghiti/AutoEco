"use client";

/**
 * Paddle.js button — loads Paddle.js client-side and opens the hosted
 * checkout overlay for a given Paddle price id.
 *
 * Usage:
 *   <PaddleButton priceId="pri_..." userId="usr_..." planKey="pro" email="a@b.c" label="Upgrade to Pro" />
 *
 * Paddle.js loads itself on the next animation frame after mount via a
 * <script> tag injection (idempotent). We never bundle Paddle.js into the
 * application bundle.
 *
 * `custom_data` is what makes a purchase attributable to an AutoEco account.
 * The webhook cannot resolve a brand-new Paddle customer any other way
 * (`User.paddleCustomerId` does not exist until the webhook has already
 * run once), so we always attach `userId` + `planKey` when we know them.
 *
 * Configuration is read from `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`. If it is
 * missing the button renders in an explicit "unavailable" state instead of
 * a dead control. We never hardcode the token in source.
 *
 * ENVIRONMENT SAFETY:
 *   - Default Paddle environment = "sandbox" (no real money).
 *   - Set `NEXT_PUBLIC_PADDLE_ENV=live` ONLY when you want real charges.
 *   - `PADDLE_ENV` (server-side) is the authority for the webhook; the two
 *     must agree, so we ship the server's value to the client too.
 */
import { useEffect, useState } from "react";

declare global {
  interface Window {
    Paddle?: any;
  }
}

interface Props {
  priceId: string;
  email?: string;
  /** AutoEco user id — echoed back by Paddle in `custom_data`. */
  userId?: string;
  /** Internal plan key — echoed back in `custom_data` for audit. */
  planKey?: string;
  label: string;
  className?: string;
  disabled?: boolean;
  /** Rendered under the button when checkout is not possible. */
  unavailableHint?: string;
}

let paddleInitialized = false;

function ensurePaddleLoaded(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (window.Paddle) return resolve();
    const existing = document.querySelector<HTMLScriptElement>('script[data-paddle-js="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Paddle.js failed to load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    script.dataset.paddleJs = "1";
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Paddle.js failed to load")));
    document.head.appendChild(script);
  });
}

export function PaddleButton({
  priceId,
  email,
  userId,
  planKey,
  label,
  className,
  disabled,
  unavailableHint,
}: Props) {
  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? "";
  const paddleEnvFromBuild = process.env.NEXT_PUBLIC_PADDLE_ENV === "live" ? "live" : "sandbox";
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientToken) {
      setError("Checkout is not configured on this server.");
      return;
    }
    let cancelled = false;
    ensurePaddleLoaded()
      .then(() => {
        if (cancelled) return;
        if (window.Paddle && !paddleInitialized) {
          try {
            // Defensive: even if a live API key leaked into the bundle,
            // the JS environment is only ever initialised as "live" when
            // the build-time env explicitly says so.
            window.Paddle.Environment.set(paddleEnvFromBuild);
            window.Paddle.Initialize({ token: clientToken });
            paddleInitialized = true;
          } catch {
            setError("Checkout could not be initialised.");
            return;
          }
        }
        setReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Checkout failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [clientToken, paddleEnvFromBuild]);

  const open = async () => {
    if (!ready || !window.Paddle || !priceId) return;
    try {
      window.Paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: email ? { email } : undefined,
        // Attribution + account linkage for the webhook.
        customData: {
          ...(userId ? { userId } : {}),
          ...(planKey ? { planKey } : {}),
          brand: "AutoEco",
        },
        settings: {
          displayMode: "overlay",
          allowLogout: false,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open checkout");
    }
  };

  // A missing price id means this plan has no configured Paddle product.
  // Say so instead of rendering a button that silently does nothing.
  const noPrice = !priceId;
  const blocked = noPrice || !ready || !!error || disabled;
  const hint = noPrice ? unavailableHint : error ? unavailableHint ?? error : null;

  return (
    <div>
      <button
        type="button"
        onClick={open}
        disabled={blocked}
        aria-disabled={blocked}
        className={className ?? "btn btn-primary"}
      >
        {label}
      </button>
      {hint && <p className="mt-1 text-[11px] leading-snug text-charcoal-500">{hint}</p>}
    </div>
  );
}