import { db } from "./db";

export const FEATURE_FLAGS = {
  AI_ENRICHMENT: "ai_enrichment",
  GOOGLE_PROVIDER: "google_provider",
  OSM_PROVIDER: "osm_provider",
  DEMO_PROVIDER: "demo_provider",
  API_ACCESS: "api_access",
  REFERRAL_SYSTEM: "referral_system",
  AFFILIATE_SYSTEM: "affiliate_system",
  TEAM_ACCOUNTS: "team_accounts",
  REGISTRATION: "registration",
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

const DEFAULT_FLAG_STATE: Record<string, boolean> = {
  ai_enrichment: false,
  google_provider: true,
  osm_provider: true,
  demo_provider: true,
  api_access: true,
  referral_system: true,
  affiliate_system: true,
  team_accounts: true,
  registration: true,
};

let cache: { at: number; flags: Record<string, boolean> } | null = null;
const TTL = 15_000;

export async function getFeatureFlags(): Promise<Record<string, boolean>> {
  if (cache && Date.now() - cache.at < TTL) return cache.flags;
  const rows = await db.featureFlag.findMany();
  const flags = { ...DEFAULT_FLAG_STATE };
  for (const r of rows) flags[r.key] = r.enabled;
  cache = { at: Date.now(), flags };
  return flags;
}

export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
  const flags = await getFeatureFlags();
  return flags[key] ?? false;
}

export async function setFeatureFlag(
  key: string,
  enabled: boolean,
  description?: string
): Promise<void> {
  await db.featureFlag.upsert({
    where: { key },
    create: { key, enabled, description },
    update: { enabled, ...(description !== undefined ? { description } : {}) },
  });
  cache = null;
}

export function clearFlagCache(): void {
  cache = null;
}
