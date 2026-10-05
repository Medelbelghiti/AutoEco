import { NextResponse } from "next/server";
import { withErrorHandling, parseJson, ok } from "@/lib/http";
import { SignupSchema } from "@/lib/schemas";
import { db } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { getTrialSettings } from "@/lib/settings";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyCaptcha } from "@/lib/captcha";
import { getClientIp, randomToken, sha256 } from "@/lib/utils";
import { sendEmail, tplWelcome, tplTrialStarted, tplEmailVerify } from "@/lib/email";
import { createNotification } from "@/lib/notifications";
import { env } from "@/lib/env";
import { trackEvent } from "@/lib/analytics";

export const POST = withErrorHandling(async (req) => {
  const ip = getClientIp(req);
  const rl = await checkRateLimit({ key: `signup:${ip}`, limit: 10, windowSeconds: 3600 });
  if (!rl.allowed) return NextResponse.json({ error: "Too many signups from this IP" }, { status: 429 });

  if (!(await isFeatureEnabled("registration"))) {
    return NextResponse.json({ error: "Registration is currently disabled" }, { status: 403 });
  }

  const body = await parseJson(req, SignupSchema);
  if (!(await verifyCaptcha(body.captchaToken, ip))) {
    return NextResponse.json({ error: "Captcha verification failed. Please try again." }, { status: 400 });
  }
  const existing = await db.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (existing) return NextResponse.json({ error: "An account already exists for this email" }, { status: 409 });

  const free = await db.plan.findFirst({ where: { key: "free", active: true } });
  const trial = await getTrialSettings();
  const trialEndsAt = trial.trial_enabled ? new Date(Date.now() + trial.trial_duration_days * 24 * 60 * 60 * 1000) : null;

  const user = await db.user.create({
    data: {
      email: body.email.toLowerCase(),
      passwordHash: await hashPassword(body.password),
      name: body.name ?? null,
      role: "USER",
      locale: body.locale ?? "en",
      planId: free?.id ?? null,
      currency: "USD",
      distanceUnit: "km",
      fuelUnit: "L_PER_100KM",
      trialEndsAt,
      signupIp: ip,
    },
  });

  const verifyToken = randomToken(24);
  await db.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(verifyToken),
      type: "VERIFY_EMAIL",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const verifyUrl = `${env.appUrl}/verify-email?token=${verifyToken}`;
  await sendEmail({ ...tplEmailVerify(user.name, verifyUrl), to: user.email });
  await sendEmail({ ...tplWelcome(user.name, env.appUrl), to: user.email });
  if (trialEndsAt) {
    await sendEmail({ ...tplTrialStarted(user.name, env.appUrl, trial.trial_duration_days), to: user.email });
  }

  await createNotification({
    userId: user.id, type: "GENERAL",
    title: "Welcome to AutoEco",
    body: "Verify your email to secure your account.",
    link: "/settings",
  });

  await createSession(user.id, user.sessionVersion);
  await trackEvent("signup", { userId: user.id });
  if (trialEndsAt) await trackEvent("trial_started", { userId: user.id });

  return ok({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    trialActive: Boolean(trialEndsAt),
  });
});
