"use client";

// Renders a fenced ```mermaid code block as an actual diagram (flowchart,
// sequence diagram, pie chart, xy/bar/line chart, timeline, etc.) instead of
// raw text — mermaid.render() produces an SVG string that we inject
// directly. This is what lets Lain draw real diagrams (e.g. the OSI model,
// a network topology, a memory graph, an automation workflow) instead of
// only describing them in prose. Client-only: mermaid needs a DOM to
// measure/lay out text, so this can't run during SSR.

import { useEffect, useId, useRef, useState } from "react";

// The model doesn't reliably follow prompt instructions to quote node label
// text containing special characters (parentheses, colons, etc.) inside
// [...]/{...} shapes, e.g. `A[Header (Min 20 Bytes)]` — Mermaid's parser
// treats "(" as meaningful shape syntax and fails with "Syntax error in
// text". Rather than depend on prompt compliance, deterministically
// auto-quote any bracketed label that contains risky characters and isn't
// already quoted, before handing the code to mermaid.render().
function sanitizeMermaidLabels(code) {
  if (!code) return code;

  const quoteInner = (inner) => {
    const trimmed = inner.trim();
    if (trimmed === "") return null;
    if (/^".*"$/.test(trimmed)) return null; // already quoted
    if (!/[():;,#{}<>]/.test(trimmed)) return null; // nothing risky, leave as-is
    return trimmed.replace(/"/g, "'");
  };

  let result = code.replace(/\[([^[\]\n]*)\]/g, (match, inner) => {
    const safe = quoteInner(inner);
    return safe === null ? match : `["${safe}"]`;
  });

  result = result.replace(/\{([^{}\n]*)\}/g, (match, inner) => {
    const safe = quoteInner(inner);
    return safe === null ? match : `{"${safe}"}`;
  });

  return result;
}

let mermaidPromise = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "dark",
        themeVariables: {
          darkMode: true,
          background: "transparent",
          primaryColor: "#2a1f3d",
          primaryTextColor: "#e6def7",
          primaryBorderColor: "#8a6fd8",
          lineColor: "#8a6fd8",
          secondaryColor: "#3d2a5c",
          tertiaryColor: "#1a1424",
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export default function MermaidDiagram({ code }) {
  const containerRef = useRef(null);
  const [error, setError] = useState("");
  const id = useId().replace(/[:]/g, "");

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const mermaid = await loadMermaid();
        const { svg } = await mermaid.render(`mermaid-${id}`, sanitizeMermaidLabels(code.trim()));
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || "Couldn't render this diagram.");
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (error) {
    return (
      <div className="my-2 rounded-lg border border-[var(--lain-accent)]/40 bg-black/20 p-3 text-xs text-[var(--lain-muted)]">
        <p className="mb-1 text-[var(--lain-accent-light)]">Couldn&apos;t render diagram: {error}</p>
        <pre className="overflow-x-auto whitespace-pre-wrap">{code}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-2 flex justify-center overflow-x-auto rounded-lg bg-black/20 p-3 [&_svg]:max-w-full"
    />
  );
}
