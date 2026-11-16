import { getStories } from '../../lib/data.js';
import { LANGS, t, SITE_NAME } from '../../lib/i18n.js';
import { href, storyUrl } from '../../lib/url.js';

export function getStaticPaths() {
  return LANGS.map((lang) => ({ params: { lang } }));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function GET({ params, site }) {
  const { lang } = params;
  const L = t(lang);
  const abs = (p) => new URL(p, site).toString();
  const items = getStories().slice(0, 50).map((s) => `
    <item>
      <title>${esc(s[lang].title)}</title>
      <link>${abs(storyUrl(lang, s))}</link>
      <guid isPermaLink="true">${abs(storyUrl(lang, s))}</guid>
      <pubDate>${new Date(s.date).toUTCString()}</pubDate>
      <category>${esc(L.status[s.status].label)}</category>
      <category>${esc(L.topics[s.topic])}</category>
      <description>${esc(s[lang].summary)}</description>
    </item>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(SITE_NAME)}</title>
    <link>${abs(href(`/${lang}/`))}</link>
    <description>${esc(L.tagline)}</description>
    <language>${lang}</language>${items}
  </channel>
</rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
}
