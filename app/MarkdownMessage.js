"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MermaidDiagram from "./MermaidDiagram";

// Local models don't always follow markdown-list instructions and
// sometimes run several items together on one line separated by a "•"
// character instead of real Markdown list syntax — that renders as an
// unreadable wall of text. lib/briefing.js already fixes this up at
// generation time for freshly-built digests, but that only covers new
// messages; anything stored before that fix (or produced by some other
// path that slips past the LLM's formatting instructions) still has the
// raw "•" text sitting in the database. Doing it here too, at render
// time, self-heals every message — old or new — regardless of source.
function normalizeBulletFormatting(text) {
  if (!text || !text.includes("•")) return text;
  const parts = text.split("•").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return text;
  const [intro, ...items] = parts;
  const list = items.map((part) => `- ${part}`).join("\n");
  return intro ? `${intro}\n\n${list}` : list;
}

/**
 * Renders assistant/user chat message content as Markdown (bold, italics,
 * headings, lists, links, code, tables via remark-gfm) instead of raw
 * text — the LLM is instructed to format responses (and cite news sources)
 * using Markdown, but the chat bubble previously just dumped the raw
 * string via <p>, so all that formatting showed up as literal
 * asterisks/hashes instead of being rendered.
 */
export default function MarkdownMessage({ content }) {
  return (
    <div className="markdown-message text-sm leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--lain-highlight-soft)] underline hover:text-[var(--lain-highlight)] break-all"
            />
          ),
          code: ({ node, inline, className, children, ...props }) => {
            const isMermaid = !inline && /language-mermaid/.test(className || "");
            if (isMermaid) {
              return <MermaidDiagram code={String(children).replace(/\n$/, "")} />;
            }
            return inline ? (
              <code
                className="rounded bg-black/30 px-1 py-0.5 text-[0.85em]"
                {...props}
              >
                {children}
              </code>
            ) : (
              <code
                className="block overflow-x-auto rounded-lg bg-black/30 p-3 text-[0.85em]"
                {...props}
              >
                {children}
              </code>
            );
          },
          ul: ({ node, ...props }) => (
            <ul className="list-disc pl-5 my-1 space-y-0.5" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="list-decimal pl-5 my-1 space-y-0.5" {...props} />
          ),
          li: ({ node, ...props }) => <li className="my-0.5" {...props} />,
          h1: ({ node, ...props }) => (
            <h1 className="text-lg font-bold mt-2 mb-1" {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h2 className="text-base font-bold mt-2 mb-1" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className="text-sm font-bold mt-2 mb-1" {...props} />
          ),
          p: ({ node, ...props }) => <p className="my-1" {...props} />,
          blockquote: ({ node, ...props }) => (
            <blockquote
              className="border-l-2 border-[var(--lain-border)] pl-3 my-1 text-[var(--lain-muted)]"
              {...props}
            />
          ),
          hr: () => <hr className="my-2 border-[var(--lain-border)]" />,
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-2">
              <table className="border-collapse w-full text-xs" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th
              className="border border-[var(--lain-border)] px-2 py-1 text-left font-semibold"
              {...props}
            />
          ),
          td: ({ node, ...props }) => (
            <td className="border border-[var(--lain-border)] px-2 py-1" {...props} />
          ),
        }}
      >
        {normalizeBulletFormatting(content)}
      </ReactMarkdown>
    </div>
  );
}
