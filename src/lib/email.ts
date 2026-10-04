import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";
import { auditLog } from "./audit";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export interface EmailProvider {
  send(msg: EmailMessage): Promise<{ ok: boolean; error?: string }>;
  getName(): string;
}

class ConsoleProvider implements EmailProvider {
  getName() {
    return "console";
  }
  async send(msg: EmailMessage): Promise<{ ok: boolean }> {
    // eslint-disable-next-line no-console
    console.log(`[email:console] -> ${msg.to} | ${msg.subject}`);
    if (msg.text) {
      // eslint-disable-next-line no-console
      console.log(msg.text);
    } else {
      // eslint-disable-next-line no-console
      console.log(msg.html.replace(/<[^>]+>/g, "").slice(0, 500));
    }
    await auditLog({
      action: "email.sent",
      metadata: { provider: "console", to: maskEmail(msg.to), subject: msg.subject },
    });
    return { ok: true };
  }
}

class SmtpProvider implements EmailProvider {
  private transporter: Transporter | null = null;
  getName() {
    return "smtp";
  }
  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpPort === 465,
        auth:
          env.smtpUser || env.smtpPass
            ? { user: env.smtpUser, pass: env.smtpPass }
            : undefined,
      });
    }
    return this.transporter;
  }
  async send(msg: EmailMessage): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.getTransporter().sendMail({
        from: env.emailFrom,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
      await auditLog({
        action: "email.sent",
        metadata: { provider: "smtp", to: maskEmail(msg.to), subject: msg.subject },
      });
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await auditLog({
        action: "email.failed",
        metadata: { provider: "smtp", to: maskEmail(msg.to), error },
      });
      return { ok: false, error };
    }
  }
}

let providerInstance: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (providerInstance) return providerInstance;
  providerInstance =
    env.emailProvider === "smtp" && env.smtpHost ? new SmtpProvider() : new ConsoleProvider();
  return providerInstance;
}

export async function sendEmail(msg: EmailMessage): Promise<{ ok: boolean; error?: string }> {
  return getEmailProvider().send(msg);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

// ---- Transactional templates (plain HTML + text) -----------------------------

export function tplWelcome(name: string | null, appUrl: string): EmailMessage {
  const display = name ?? "there";
  return {
    to: "",
    subject: "Welcome to AutoEco",
    html: `<p>Hi ${escape(display)},</p><p>Welcome to <strong>AutoEco</strong> — the financial operating system for your car.</p><p>Add your vehicle, log fuel and expenses, and AutoEco works out what your car really costs per month and per kilometer.</p><p>Get started: <a href="${appUrl}/dashboard">${appUrl}/dashboard</a></p>`,
    text: `Welcome to AutoEco. Add your car and start tracking: ${appUrl}/dashboard`,
  };
}

export function tplEmailVerify(name: string | null, link: string): EmailMessage {
  return {
    to: "",
    subject: "Verify your AutoEco email",
    html: `<p>Hi ${escape(name ?? "there")},</p><p>Please verify your email by clicking the link below:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`,
    text: `Verify your email: ${link} (expires in 24 hours)`,
  };
}

export function tplPasswordReset(name: string | null, link: string): EmailMessage {
  return {
    to: "",
    subject: "Reset your AutoEco password",
    html: `<p>Hi ${escape(name ?? "there")},</p><p>Use the link below to reset your password:</p><p><a href="${link}">${link}</a></p><p>If you did not request this, you can ignore this email.</p>`,
    text: `Reset your password: ${link}`,
  };
}

export function tplTrialStarted(name: string | null, appUrl: string, days: number): EmailMessage {
  return {
    to: "",
    subject: `Your AutoEco ${days}-day free trial is active`,
    html: `<p>Hi ${escape(name ?? "there")},</p><p>Your free trial is now active. <a href="${appUrl}/dashboard">Go to your dashboard</a> and add your first vehicle.</p>`,
    text: `Your ${days}-day free trial is active. Go to ${appUrl}/dashboard`,
  };
}

export function tplTrialEnding(name: string | null, daysLeft: number, appUrl: string): EmailMessage {
  return {
    to: "",
    subject: `Your trial ends in ${daysLeft} day(s)`,
    html: `<p>Hi ${escape(name ?? "there")},</p><p>Your trial ends in ${daysLeft} day(s). <a href="${appUrl}/settings/billing">Upgrade now</a> to keep multi-vehicle tracking, forecasts and Ask Your Car.</p>`,
    text: `Trial ends in ${daysLeft} day(s). Upgrade at ${appUrl}/settings/billing`,
  };
}

export function tplPaymentSuccess(name: string | null, planName: string): EmailMessage {
  return {
    to: "",
    subject: `Payment successful — ${planName} is active`,
    html: `<p>Hi ${escape(name ?? "there")},</p><p>Your payment was successful. The <strong>${escape(planName)}</strong> plan is now active.</p>`,
    text: `Payment successful — ${planName} is active.`,
  };
}

export function tplPaymentFailed(name: string | null, appUrl: string): EmailMessage {
  return {
    to: "",
    subject: "Payment failed — action required",
    html: `<p>Hi ${escape(name ?? "there")},</p><p>We could not process your most recent payment. Please <a href="${appUrl}/settings/billing">update your billing</a> to avoid interruption.</p>`,
    text: `Payment failed. Update billing at ${appUrl}/settings/billing`,
  };
}

export function tplSubscriptionCanceled(name: string | null, endDate: string): EmailMessage {
  return {
    to: "",
    subject: "Your AutoEco subscription was canceled",
    html: `<p>Hi ${escape(name ?? "there")},</p><p>Your subscription has been canceled. You will retain access until <strong>${endDate}</strong>.</p>`,
    text: `Subscription canceled. Access until ${endDate}.`,
  };
}

export function tplUsageLimitReached(name: string | null, label: string, appUrl: string): EmailMessage {
  return {
    to: "",
    subject: `You've reached your ${label} limit`,
    html: `<p>Hi ${escape(name ?? "there")},</p><p>You've reached your current <strong>${escape(label)}</strong> limit. <a href="${appUrl}/settings/billing">Upgrade your plan</a> to continue.</p>`,
    text: `You've reached your ${label} limit. Upgrade at ${appUrl}/settings/billing`,
  };
}

// NOTE: `tplReferralConverted` and `tplAffiliatePayout` were removed on
// purpose. Their triggering systems are stubs — `referrals.ts` and
// `affiliates.ts` are documented as "V2 / unavailable" and export no-op
// functions — so neither email can ever be sent. Keeping unreachable templates
// is worse than removing them: `scripts/launch-check.mjs` reports templates
// with no caller, and a template with no caller is usually a sign that someone
// believes the feature is live. Reinstate them together with the real
// referral/affiliate implementation.

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
