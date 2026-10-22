import { MarketingShell } from "@/components/MarketingShell";
import { pageMeta } from "@/lib/seo";
import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import type { Metadata } from "next";

/**
 * Minimal, dependency-free Markdown renderer for our own legal/*.md files.
 * Supports: # ## ### headings, paragraphs, - / 1. lists, > quotes, **bold**,
 * `code`, [text](url). Everything is emitted as React nodes (no
 * dangerouslySetInnerHTML), so file content can never inject HTML.
 */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key} className="px-1 rounded bg-slate-100 text-[0.9em]">{tok.slice(1, -1)}</code>);
    else {
      const [, label, href] = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(tok)!;
      const safe = /^(https?:\/\/|mailto:|\/)/.test(href) ? href : "#";
      out.push(<a key={key} href={safe} className="underline" rel="noopener noreferrer">{label}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const nodes: React.ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let k = 0;

  const flushPara = () => {
    if (para.length) nodes.push(<p key={`p${k++}`} className="mt-3 leading-relaxed">{inline(para.join(" "), `p${k}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    nodes.push(
      <Tag key={`l${k++}`} className={`mt-3 ms-6 space-y-1 ${list.ordered ? "list-decimal" : "list-disc"}`}>
        {list.items.map((it, idx) => <li key={idx}>{inline(it, `li${k}-${idx}`)}</li>)}
      </Tag>
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    const bq = /^>\s?(.*)$/.exec(line);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (h) {
      flushPara(); flushList();
      const level = h[1].length;
      const cls = level === 1 ? "text-2xl font-bold mt-8" : level === 2 ? "text-xl font-semibold mt-6" : "text-lg font-semibold mt-4";
      nodes.push(React.createElement(`h${level + 1}`, { key: `h${k++}`, className: cls }, inline(h[2], `h${k}`)));
    } else if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((ul ?? ol)![1]);
    } else if (bq) {
      flushPara(); flushList();
      nodes.push(<blockquote key={`q${k++}`} className="mt-3 border-s-4 border-amber-400 bg-amber-50 p-3 text-sm">{inline(bq[1], `q${k}`)}</blockquote>);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  return nodes;
}

/** Matches an all-caps bracketed token such as `[LEGAL ENTITY NAME]`. */
const PLACEHOLDER_TOKEN = /\[[A-Z][A-Z0-9 _-]{2,}\]/g;

/**
 * `[SQUARE_BRACKET]` is the convention described in the documents' own banner
 * ("every `[SQUARE_BRACKET]` value below must be replaced"), not a value to
 * replace — it must never count as an outstanding placeholder, otherwise the
 * draft state would never clear.
 */
const CONVENTION_TOKEN = "SQUARE_BRACKET";

/** Every outstanding `[BRACKETED]` value in a legal document, in order. */
export function extractLegalPlaceholders(md: string): string[] {
  const found = new Set<string>();
  for (const m of md.matchAll(PLACEHOLDER_TOKEN)) {
    if (m[0].slice(1, -1) !== CONVENTION_TOKEN) found.add(m[0]);
  }
  return [...found];
}

export function legalIsDraft(md: string): boolean {
  return extractLegalPlaceholders(md).length > 0;
}

export async function readLegalFile(file: string): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), "legal", file), "utf8");
  } catch {
    return "";
  }
}

/**
 * Metadata for a legal page. A document still carrying `[BRACKETED]` values is
 * unpublished: it is excluded from the index so a draft contract is never
 * indexed as if it were the live one, and it is announced as a draft on the
 * page itself. Both signals disappear automatically once the tokens are
 * replaced.
 */
export async function legalMetadata(
  file: string,
  pageTitle: string,
  pagePath: string,
  description: string
): Promise<Metadata> {
  const body = await readLegalFile(file);
  return pageMeta({
    title: pageTitle,
    description,
    path: pagePath,
    index: !legalIsDraft(body),
  });
}

export async function LegalPage({ file, title }: { file: string; title: string }) {
  const body = await readLegalFile(file);
  const placeholders = extractLegalPlaceholders(body);
  const text = body || "Legal document not available.";
  return (
    <MarketingShell>
      <article className="container-app py-12 max-w-3xl mx-auto">
        {placeholders.length > 0 && (
          <p
            role="note"
            className="mb-6 border-s-4 border-amber-500 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm"
          >
            <strong className="font-semibold">Draft — not yet in force.</strong>{" "}
            This document still contains{" "}
            {placeholders.length === 1 ? "a placeholder" : `${placeholders.length} placeholders`} (
            {placeholders.join(", ")}) that must be filled in with the operator&apos;s
            real details before it can be relied upon.
          </p>
        )}
        <h1 className="text-3xl font-bold">{title}</h1>
        <div className="mt-6 text-sm">{renderMarkdown(text)}</div>
      </article>
    </MarketingShell>
  );
}
