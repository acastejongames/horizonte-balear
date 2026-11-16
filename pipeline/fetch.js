import { XMLParser } from 'fast-xml-parser';
import { SOURCES, BALEARIC_KEYWORDS } from './sources.js';
import { stripHtml, truncate, fold, hash, decodeEntities } from './text.js';

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 HorizonteBalear/1.0',
  accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
  'accept-language': 'es-ES,es;q=0.9,ca;q=0.8',
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  isArray: (name) => ['item', 'entry', 'url', 'link', 'enclosure'].includes(name),
});

const txt = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return txt(v[0]);
  if (typeof v === 'object') return String(v['#text'] ?? '');
  return String(v);
};

async function get(url, timeoutMs = 20000) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function atomLink(links) {
  if (!links) return '';
  for (const l of [].concat(links)) {
    if (typeof l === 'string') return l;
    if (!l['@_rel'] || l['@_rel'] === 'alternate') return l['@_href'] || txt(l);
  }
  return '';
}

const attr = (v, name) => [].concat(v ?? []).map((x) => (x && typeof x === 'object' ? x[`@_${name}`] : null)).find(Boolean) ?? '';
const firstImg = (html) => String(html ?? '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? '';

/** Mejora la URL de la foto cuando el medio da una miniatura pequeña. */
export function upgradeImage(url) {
  if (!url) return '';
  return url
    .replace(/(img\.europapress\.es\/fotoweb\/fotonoticia_\d+)_\d+\.jpg$/, '$1_800.jpg')
    .replace(/_150x0\.jpg$/, '.jpg');
}

function rssImage(it) {
  const enclosures = [].concat(it.enclosure ?? []).filter((e) => /image/i.test(e?.['@_type'] ?? 'image'));
  return upgradeImage(
    attr(enclosures, 'url') ||
      attr([].concat(it.content ?? []).filter((c) => c && typeof c === 'object' && c['@_url']), 'url') ||
      attr(it.thumbnail, 'url') ||
      firstImg(txt(it.encoded)) ||
      firstImg(txt(it.description)),
  );
}

function atomImage(e) {
  const enc = [].concat(e.link ?? []).find((l) => l?.['@_rel'] === 'enclosure' && /image/i.test(l['@_type'] ?? 'image'));
  return upgradeImage(enc?.['@_href'] || firstImg(txt(e.content)));
}

function parseFeed(xml, feedType) {
  const doc = parser.parse(xml);
  const out = [];
  if (feedType === 'news-sitemap') {
    for (const u of doc.urlset?.url ?? []) {
      const news = u.news ?? {};
      out.push({ url: txt(u.loc), title: txt(news.title), summary: '', published: txt(news.publication_date), image: txt([].concat(u.image ?? [])[0]?.loc) });
    }
    return out;
  }
  const channel = doc.rss?.channel ?? doc.RDF ?? {};
  const items = channel.item ?? doc.RDF?.item ?? [];
  for (const it of items) {
    out.push({
      url: txt(it.link) || txt(it.guid),
      title: txt(it.title),
      summary: txt(it.description) || txt(it.encoded),
      published: txt(it.pubDate) || txt(it.date),
      image: rssImage(it),
    });
  }
  for (const e of doc.feed?.entry ?? []) {
    out.push({
      url: atomLink(e.link) || txt(e.id),
      title: txt(e.title),
      summary: txt(e.summary) || txt(e.content),
      published: txt(e.published) || txt(e.updated),
      image: atomImage(e),
    });
  }
  return out;
}

function isBalearic(source, item) {
  if (source.localOnly) return true;
  const path = (() => { try { return new URL(item.url).pathname; } catch { return ''; } })();
  if (source.localPaths?.some((p) => path.includes(p))) return true;
  const text = ' ' + fold(`${item.title} ${item.summary}`) + ' ';
  return BALEARIC_KEYWORDS.some((k) => text.includes(fold(k)));
}

function normalizeUrl(u) {
  try {
    const url = new URL(decodeEntities(u).trim());
    url.hash = '';
    for (const p of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(p)) url.searchParams.delete(p);
    return url.toString();
  } catch {
    return '';
  }
}

/** Descarga todos los feeds y devuelve artículos normalizados de las últimas `maxAgeHours` horas. */
export async function fetchAllFeeds({ maxAgeHours = 48, log = console.log } = {}) {
  const now = Date.now();
  const tasks = SOURCES.flatMap((source) => source.feeds.map((feed) => ({ source, feed })));
  const results = await Promise.allSettled(tasks.map(async ({ source, feed }) => {
    const xml = await get(feed.url);
    return { source, items: parseFeed(xml, feed.type) };
  }));

  const byUrl = new Map();
  const stats = {};
  results.forEach((r, i) => {
    const { source, feed } = tasks[i];
    stats[source.id] ??= { ok: 0, failed: 0, items: 0 };
    if (r.status === 'rejected') {
      stats[source.id].failed++;
      log(`  ⚠ ${source.name}: ${feed.url} → ${r.reason?.message ?? r.reason}`);
      return;
    }
    stats[source.id].ok++;
    for (const raw of r.value.items) {
      const url = normalizeUrl(raw.url);
      const title = stripHtml(raw.title);
      if (!url || !title || byUrl.has(url)) continue;
      const published = raw.published ? new Date(raw.published) : new Date();
      const pubMs = isNaN(published) ? now : published.getTime();
      if (now - pubMs > maxAgeHours * 3600e3) continue;
      const item = {
        id: hash(url),
        url,
        sourceId: source.id,
        lang: source.lang,
        title,
        summary: truncate(stripHtml(raw.summary), 1000),
        published: new Date(Math.min(pubMs, now)).toISOString(),
        ...(raw.image && /^https?:\/\//.test(raw.image) ? { image: decodeEntities(raw.image) } : {}),
      };
      if (!isBalearic(source, item)) continue;
      byUrl.set(url, item);
      stats[source.id].items++;
    }
  });
  return { items: [...byUrl.values()], stats };
}

/** Lee la descripción y la foto principal (og:image) de la página de un artículo. */
export async function fetchPageMeta(url) {
  const html = await get(url, 15000);
  const head = html.slice(0, 200000);
  const meta = (prop) =>
    head.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1] ??
    head.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'))?.[1];
  const image = decodeEntities(meta('og:image') ?? meta('twitter:image') ?? '');
  return {
    description: truncate(stripHtml(meta('og:description') ?? meta('description') ?? ''), 1000),
    image: /^https?:\/\//.test(image) ? upgradeImage(image) : '',
  };
}

/** Para medios sin resumen en el feed (p. ej. sitemaps), lee la meta descripción de la página. */
export async function enrichMissingSummaries(items, { limit = 40, concurrency = 4 } = {}) {
  const queue = items.filter((i) => !i.summary).slice(0, limit);
  let idx = 0;
  async function worker() {
    while (idx < queue.length) {
      const item = queue[idx++];
      try {
        const m = await fetchPageMeta(item.url);
        item.summary = m.description;
        if (!item.image && m.image) item.image = m.image;
      } catch {
        /* sin resumen: se usará solo el titular */
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}
