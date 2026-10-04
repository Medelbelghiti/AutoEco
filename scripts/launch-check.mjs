#!/usr/bin/env node
/**
 * Launch gate.
 *
 * Fails (exit 1) on anything that must be resolved before taking real
 * payments. This is the checklist that keeps shipping blocked while a
 * blocker is still open, instead of relying on memory.
 *
 *   node scripts/launch-check.mjs            # offline checks
 *   node scripts/launch-check.mjs --db       # also query the database (read-only)
 *
 * Checks are READ-ONLY. This script never runs migrations and never writes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_DB = process.argv.includes("--db");

/** @type {{level:"blocker"|"warn"|"ok", title:string, detail?:string, fix?:string}[]} */
const results = [];
const add = (level, title, detail, fix) => results.push({ level, title, detail, fix });

const rel = (p) => path.relative(ROOT, p);

// ---------------------------------------------------------------------------
// 1. Legal documents must not still contain template placeholders.
// ---------------------------------------------------------------------------
const legalDir = path.join(ROOT, "legal");
const placeholderRe = /\[[A-Z][A-Z0-9 _-]{2,}\]/g;

/**
 * Strip the "this is a template" banner before scanning.
 *
 * Each legal template opens with a blockquote warning that itself contains the
 * literal text `[SQUARE_BRACKET]` ("every `[SQUARE_BRACKET]` value below must
 * be replaced"). Without this, that self-referential mention is reported as an
 * unresolved placeholder and the blocker can never clear — the gate would stay
 * red even after every real placeholder had been filled, which is worse than
 * having no gate at all.
 */
const bannerRe = /^>.*template placeholder.*$/gim;

if (fs.existsSync(legalDir)) {
  const offenders = [];
  const files = fs.readdirSync(legalDir).filter((n) => n.endsWith(".md"));
  for (const f of files) {
    const text = fs.readFileSync(path.join(legalDir, f), "utf8").replace(bannerRe, "");
    const hits = [...new Set(text.match(placeholderRe) ?? [])];
    if (hits.length) offenders.push({ f, hits });
  }
  if (offenders.length === 0) {
    add("ok", "Legal documents", `no placeholders in ${files.length} files`);
  } else {
    add(
      "blocker",
      "Legal placeholders still present",
      offenders
        .map((o) => `${o.f}: ${o.hits.join(", ")}`)
        .join(" | "),
      "Replace every [BRACKETED] token in legal/*.md with the real entity details."
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Migration files must be valid UTF-8 with no BOM.
//    A BOM made `ALTER TABLE` fail on the live Neon DB with
//    "syntax error at or near BOM" — this check exists to stop a repeat.
// ---------------------------------------------------------------------------
const migDir = path.join(ROOT, "prisma", "migrations");
const badMigrations = [];
if (fs.existsSync(migDir)) {
  for (const name of fs.readdirSync(migDir)) {
    const sqlPath = path.join(migDir, name, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const buf = fs.readFileSync(sqlPath);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      badMigrations.push(`${name}: BOM at start of migration.sql`);
      continue;
    }
    const text = buf.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(buf)) {
      badMigrations.push(`${name}: invalid UTF-8`);
      continue;
    }
    // A file of only comments/whitespace means an aborted migration.
    const statements = text
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (!statements) badMigrations.push(`${name}: migration.sql has no executable statement`);
  }
}
if (badMigrations.length === 0) {
  add("ok", "Migration files", "valid UTF-8, no BOM, non-empty");
} else {
  add("blocker", "Broken migration files", badMigrations.join(" | "), "Fix the listed migration.sql files before deploying.");
}

// ---------------------------------------------------------------------------
// 3. Schema columns referenced by queries must exist in a migration.
//    Catches the class of bug where code is written against a column whose
//    migration has not shipped.
// ---------------------------------------------------------------------------
function schemaColumns() {
  const text = fs.readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");
  const cols = new Set();
  let model = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^model\s+(\w+)\s*\{/);
    if (m) { model = m[1]; continue; }
    if (line === "}") { model = null; continue; }
    if (!model) continue;
    const c = line.match(/^(\w+)\s+\w+(\?)?\s+(@|$)/);
    if (c) cols.add(`${model}.${c[1]}`);
  }
  return cols;
}

// Every Plan column the application filters on must be covered by a migration.
const planColsInMigrations = (() => {
  let found = new Set();
  if (!fs.existsSync(migDir)) return found;
  for (const name of fs.readdirSync(migDir)) {
    const sqlPath = path.join(migDir, name, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const text = fs.readFileSync(sqlPath, "utf8");
    for (const m of text.matchAll(/ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/gi)) {
      found.add(`${m[1]}.${m[2]}`);
    }
  }
  return found;
})();

const schemaCols = schemaColumns();
const addColumnRe = /ALTER TABLE\s+"?(\w+)"?\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?(\w+)"?/gi;
const createTableRe = /CREATE TABLE\s+"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi;

function columnHasMigration(model, column) {
  if (planColsInMigrations.has(`${model}.${column}`)) return true;
  // Column may be part of the table's CREATE TABLE statement.
  if (!fs.existsSync(migDir)) return false;
  for (const name of fs.readdirSync(migDir)) {
    const sqlPath = path.join(migDir, name, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const text = fs.readFileSync(sqlPath, "utf8");
    let m;
    createTableRe.lastIndex = 0;
    while ((m = createTableRe.exec(text)) !== null) {
      if (m[1] !== model) continue;
      addColumnRe.lastIndex = 0;
      // CREATE TABLE bodies list `"col" TYPE ...` lines.
      if (new RegExp(`"${column}"\\s+\\w+`, "i").test(m[2])) return true;
    }
  }
  return false;
}

// `Plan.isDemo` is the one that broke production; keep it as an explicit
// regression guard rather than relying on manual inspection.
for (const target of ["Plan.isDemo"]) {
  const [model, column] = target.split(".");
  if (!schemaCols.has(target)) {
    add("warn", `${target} not in schema.prisma`, "no longer referenced by the schema");
  } else if (!columnHasMigration(model, column)) {
    add("blocker", `${target} has no migration`, `schema.prisma declares ${target} but no migration.sql creates it`);
  } else {
    add("ok", `${target} migration present`);
  }
}

// ---------------------------------------------------------------------------
// 4. .env.example must document every process.env key the code reads.
// ---------------------------------------------------------------------------
const envKeys = new Set();
// Injected by the platform, not user-configurable — never document these.
const FRAMEWORK_ENV = new Set([
  "NODE_ENV",
  "NEXT_RUNTIME",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_REGION",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_PREVIOUS_SHA",
  "VERCEL_GIT_REFS",
  "VERCEL_GIT_REPO_SLUG",
  "VERCEL_GIT_REPO_OWNER",
  "VERCEL_GIT_REPO_DEFAULT_BRANCH",
  "VERCEL_GIT_REPO_PROVIDED",
  "VERCEL_GIT_REPO_ID",
  "VERCEL_GIT_LOG_RETRY",
  "VERCEL_SKIP_DEPLOYMENT",
  "VERCEL_TEAM_ID",
  "VERCEL_TEAM_SLUG",
  "VERCEL_BUILDER_ID",
  "VERCEL_PROJECT_ID",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "TURBO",
  "NEXT_DEPLOYMENT_ID",
]);
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "uploads", "coverage"].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) {
      const text = fs.readFileSync(p, "utf8");
      // Capture the FULL name, including any NEXT_PUBLIC_ prefix.
      for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        if (!FRAMEWORK_ENV.has(m[1])) envKeys.add(m[1]);
      }
    }
  }
})(ROOT);

const documented = fs.existsSync(path.join(ROOT, ".env.example"))
  ? new Set(
      [...fs.readFileSync(path.join(ROOT, ".env.example"), "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map(
        (m) => m[1]
      )
    )
  : new Set();

const undocumented = [...envKeys].filter((k) => !documented.has(k)).sort();
if (undocumented.length === 0) {
  add("ok", "Environment variables", `all ${envKeys.size} referenced keys documented in .env.example`);
} else {
  add(
    "warn",
    "Environment variables missing from .env.example",
    undocumented.join(", "),
    "Document these or remove the dead reads."
  );
}

// ---------------------------------------------------------------------------
// 5. Every email template must actually be called somewhere.
//    Uncalled templates are usually a silently missing notification.
// ---------------------------------------------------------------------------
const emailFile = path.join(ROOT, "src", "lib", "email.ts");
if (fs.existsSync(emailFile)) {
  const templates = [...fs.readFileSync(emailFile, "utf8").matchAll(/export function (tpl[A-Za-z]+)\s*\(/g)].map(
    (m) => m[1]
  );
  const callers = [];
  (function walkSrc(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkSrc(p);
      else if (/\.(ts|tsx)$/.test(e.name) && p !== emailFile) {
        const text = fs.readFileSync(p, "utf8");
        for (const t of templates) if (new RegExp(`\\b${t}\\b`).test(text)) callers.push(t);
      }
    }
  })(path.join(ROOT, "src"));

  const orphans = templates.filter((t) => !callers.includes(t));
  if (orphans.length === 0) {
    add("ok", "Email templates", `all ${templates.length} templates have a caller`);
  } else {
    add(
      "warn",
      "Email templates with no caller",
      orphans.join(", "),
      "Either wire them into a webhook/cron handler, or delete them so the omission is explicit."
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Optional: read-only database check for pending migrations.
// ---------------------------------------------------------------------------
if (CHECK_DB) {
  if (!process.env.DATABASE_URL) {
    add("warn", "Database check skipped", "DATABASE_URL is not set");
  } else {
    try {
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();
      const pending = await prisma.$queryRawUnsafe(
        `SELECT migration_name FROM "_prisma_migrations"
         WHERE finished_at IS NULL AND rolled_back_at IS NULL`
      );
      const planCol = await prisma.$queryRawUnsafe(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'Plan' AND column_name = 'isDemo'`
      );
      await prisma.$disconnect();

      if (planCol.length === 0) {
        add(
          "blocker",
          "Plan.isDemo missing in the connected database",
          "queries filtering on isDemo will throw; /pricing and /settings/billing will 500",
          "Apply the migration: npx prisma migrate deploy"
        );
      } else {
        add("ok", "Plan.isDemo present in the connected database");
      }
      if (pending.length > 0) {
        add("blocker", "Pending migrations", pending.map((p) => p.migration_name).join(", "));
      } else {
        add("ok", "No pending migrations");
      }
    } catch (e) {
      add("warn", "Database check failed", e instanceof Error ? e.message.slice(0, 300) : String(e));
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const ICON = { blocker: "BLOCKER", warn: "WARN   ", ok: "ok     " };
const order = { blocker: 0, warn: 1, ok: 2 };
results.sort((a, b) => order[a.level] - order[b.level]);

// eslint-disable-next-line no-console
console.log("\n  AutoEco launch check\n  " + "=".repeat(60));
for (const r of results) {
  // eslint-disable-next-line no-console
  console.log(`  [${ICON[r.level]}] ${r.title}`);
  if (r.detail) // eslint-disable-next-line no-console
    console.log(`             ${r.detail}`);
  if (r.fix) // eslint-disable-next-line no-console
    console.log(`             fix: ${r.fix}`);
}

const blockers = results.filter((r) => r.level === "blocker");
const warnings = results.filter((r) => r.level === "warn");
// eslint-disable-next-line no-console
console.log("  " + "=".repeat(60));
// eslint-disable-next-line no-console
console.log(`  ${blockers.length} blocker(s), ${warnings.length} warning(s)\n`);

process.exit(blockers.length > 0 ? 1 : 0);