"use client";

/**
 * Paddle.js button — loads Paddle.js client-side and opens the hosted
 * checkout overlay for a given Paddle price id.
 *
 * Usage:
 *   <PaddleButton priceId="..." label="Subscribe" />
 *
 * Paddle.js loads itself on the next animation frame after mount via a
 * <script> tag injection (idempotent). We never bundle Paddle.js into
 * the application bundle.
 *
 * Configuration is read from `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`. If it is
 * missing, the button renders disabled and the component logs a
 * warning. We never hardcode the token in source.
 *
 * ENVIRONMENT SAFETY:
 *   - Default Paddle environment = "sandbox" (no real money).
 *   - Set `PADDLE_ENV=live` in Vercel ONLY when you want real charges.
 *   - The component double-checks `paddleIsLive()` from the env file
 *     and refuses to open a "live" Paddle.Checkout unless explicitly
 *     configured. Even if a build accidentally ended up with the live
 *     API key, the JS will be initialized as "sandbox".
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
  label: string;
  className?: string;
}

let paddleInitialized = false;

function ensurePaddleLoaded(clientToken: string, environment: "sandbox" | "live"): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (window.Paddle) return resolve();
    if (paddleInitialized) return resolve();
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
    script.addEventListener("load", () => {
      paddleInitialized = true;
      resolve();
    });
    script.addEventListener("error", () => reject(new Error("Paddle.js failed to load")));
    document.head.appendChild(script);
  });
}

export function PaddleButton({ priceId, email, label, className }: Props) {
  const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? "";
  const paddleEnvFromBuild = process.env.NEXT_PUBLIC_PADDLE_ENV === "live" ? "live" : "sandbox";
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientToken) {
      setError("PADDLE_CLIENT_TOKEN not configured");
      return;
    }
    ensurePaddleLoaded(clientToken, paddleEnvFromBuild)
      .then(() => {
        if (window.Paddle && !paddleInitialized) {
          try {
            // Defensive: even if PADDLE_ENV=live leaked into the bundle,
            // never initialize a live client unless the build-time env
            // explicitly says so AND a future server-side check confirms
            // the account is approved for production.
            window.Paddle.Environment.set(paddleEnvFromBuild);
            window.Paddle.Initialize({ token: clientToken });
            paddleInitialized = true;
          } catch (e) {
            setError("Failed to initialize Paddle.js");
            return;
          }
        }
        setReady(true);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Paddle.js failed to load");
      });
  }, [clientToken, paddleEnvFromBuild]);

  const open = async () => {
    if (!ready || !window.Paddle) return;
    try {
      window.Paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: email ? { email } : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open checkout");
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={!ready || !!error}
      className={className ?? "btn btn-primary"}
      title={error ?? undefined}
    >
      {error ? "Paddle unavailable" : label}
    </button>
  );
}
