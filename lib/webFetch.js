// Fetches a web page the user links Lain to (an article, advisory, CVE
// writeup, blog post, etc.) and extracts readable text from the HTML, so
// she can summarize it or fold relevant parts into the threat intel
// library via add_threat_intel. Lightweight regex-based extraction (same
// philosophy as lib/news.js) rather than pulling in a full HTML parser —
// good enough for "give me the readable text of this page", not meant to
// perfectly render arbitrary layouts.

const MAX_CONTENT_CHARS = 12000;
const FETCH_TIMEOUT_MS = 15000;
// Stop reading the response body once it's clearly too large — protects
// against being pointed at a huge file and prevents pulling more into
// memory than could ever fit in a model prompt anyway.
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** Strips scripts/styles/tags from HTML and collapses whitespace into readable text. */
function htmlToText(html) {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    // Block-level tags become paragraph breaks so the extracted text isn't
    // one giant run-on line.
    .replace(/<\/(p|div|br|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]).trim() : "";
}

/**
 * Fetches a URL and returns its extracted readable text (title + body,
 * truncated to a prompt-friendly size). Throws on invalid/unreachable
 * URLs or non-HTML/text responses.
 */
export async function fetchWebPage(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) throw new Error("url is required");

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${url}" isn't a valid URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http:// and https:// URLs are supported");
  }

  const res = await fetch(parsed.toString(), {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      // Some sites block requests with no/blank UA.
      "User-Agent": "Mozilla/5.0 (compatible; LainAssistant/1.0)",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Page responded with ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const isTextLike = /text\/|html|json|xml/i.test(contentType) || !contentType;
  if (!isTextLike) {
    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Page is too large (${contentLength} bytes) to fetch`);
  }

  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Page is too large (${buf.byteLength} bytes) to fetch`);
  }
  const html = Buffer.from(buf).toString("utf-8");

  const title = extractTitle(html);
  const text = /html/i.test(contentType) || /<html/i.test(html.slice(0, 500))
    ? htmlToText(html)
    : html.trim();

  const truncated = text.length > MAX_CONTENT_CHARS;
  return {
    url: parsed.toString(),
    title,
    content: truncated ? text.slice(0, MAX_CONTENT_CHARS) : text,
    truncated,
  };
}
