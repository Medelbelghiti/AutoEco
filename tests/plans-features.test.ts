import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { PLANS } from "../prisma/plans.data";
import { COMING_SOON_FEATURES } from "@/lib/plans";

/**
 * The words a bullet must never carry while its feature is still unbuilt.
 *
 * Keyed by the flag itself so the guard and the product can never drift: the
 * day a feature ships and its entry is removed from COMING_SOON_FEATURES, the
 * corresponding pattern stops being checked.
 */
const COMING_SOON_LABEL: Record<keyof typeof COMING_SOON_FEATURES, RegExp> = {
  receiptScanning: /receipt/i,
  familySharing: /family|sharing/i,
  apiAccess: /\bapi\b/i,
};

function migrationSql(folderSuffix: string): string {
  const dir = join(__dirname, "..", "prisma", "migrations");
  const folder = readdirSync(dir).find((d) => d.endsWith(folderSuffix));
  expect(folder, `a *_${folderSuffix} migration exists`).toBeTruthy();
  return readFileSync(join(dir, folder as string, "migration.sql"), "utf8");
}

describe("plan marketing bullets", () => {
  it("never advertise a feature that is flagged coming soon", () => {
    for (const plan of PLANS) {
      for (const bullet of plan.features) {
        for (const [flag, enabled] of Object.entries(COMING_SOON_FEATURES)) {
          if (!enabled) continue;
          const pattern = COMING_SOON_LABEL[flag as keyof typeof COMING_SOON_FEATURES];
          expect(
            pattern.test(bullet),
            `plan "${plan.key}" advertises "${bullet}" but ${flag} is still coming soon`
          ).toBe(false);
        }
      }
    }
  });

  it("the update_plan_features migration mirrors plans.data.ts exactly", () => {
    const sql = migrationSql("update_plan_features");
    for (const plan of PLANS) {
      const re = new RegExp(
        `UPDATE "Plan" SET "features" = '([^']*)' WHERE "key" = '${plan.key}'`
      );
      const match = re.exec(sql);
      expect(match, `migration sets features for "${plan.key}"`).not.toBeNull();
      expect(JSON.parse((match as RegExpExecArray)[1])).toEqual(plan.features);
    }
  });

  it("only writes the features column, keyed by plan key, with fixed values", () => {
    const sql = migrationSql("update_plan_features")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    expect(statements.length).toBe(PLANS.length);
    for (const stmt of statements) {
      // Exactly the `features` column is written, rows matched by plan key.
      expect(stmt).toMatch(/^UPDATE "Plan" SET "features" = '[^']*' WHERE "key" = '[a-z_]+'$/);
      // Never price, limits, flags or active state.
      expect(stmt).not.toMatch(/"priceCents"|"maxVehicles"|"active"|"enable[A-Za-z]+"/);
    }
    // Idempotent: literal values only, no subqueries or expressions that could
    // drift between runs.
    expect(sql).not.toMatch(/SELECT|COALESCE|\|\|/);
  });
});
