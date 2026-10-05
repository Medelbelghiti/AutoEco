import { MarketingShell } from "@/components/MarketingShell";
import fs from "node:fs/promises";
import path from "node:path";
import React from "react";

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
      <Tag key={`l${k++}`} className={`mt-3 ml-6 space-y-1 ${list.ordered ? "list-decimal" : "list-disc"}`}>
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
      nodes.push(<blockquote key={`q${k++}`} className="mt-3 border-l-4 border-amber-400 bg-amber-50 p-3 text-sm">{inline(bq[1], `q${k}`)}</blockquote>);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  return nodes;
}

export async function LegalPage({ file, title }: { file: string; title: string }) {
  let body = "";
  try {
    body = await fs.readFile(path.join(process.cwd(), "legal", file), "utf8");
  } catch {
    body = "Legal document not available.";
  }
  return (
    <MarketingShell>
      <article className="container-app py-12 max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold">{title}</h1>
        <div className="mt-6 text-sm">{renderMarkdown(body)}</div>
      </article>
    </MarketingShell>
  );
}
