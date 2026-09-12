// Free, no-API-key headline fetch for the "news" reminder action and the
// get_news tool. Parses a plain RSS feed with lightweight regexes rather
// than pulling in an XML parser dependency — these feeds are simple/stable
// enough that this is reliable in practice.

const FEED_URL = process.env.LAIN_NEWS_FEED_URL || "https://feeds.bbci.co.uk/news/rss.xml";

function decodeEntities(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

export async function fetchTopHeadlines(topic, limit = 5) {
  const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`News feed responded with ${res.status}`);
  const xml = await res.text();

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  let headlines = items
    .map((item) => {
      const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
      return {
        title: titleMatch ? decodeEntities(titleMatch[1]) : "",
        link: linkMatch ? decodeEntities(linkMatch[1]) : "",
      };
    })
    .filter((h) => h.title);

  if (topic) {
    const q = topic.toLowerCase();
    const filtered = headlines.filter((h) => h.title.toLowerCase().includes(q));
    if (filtered.length > 0) headlines = filtered;
  }

  return { headlines: headlines.slice(0, limit) };
}
