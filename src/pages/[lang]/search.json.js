import { getStories } from '../../lib/data.js';
import { LANGS } from '../../lib/i18n.js';
import { storyUrl } from '../../lib/url.js';

export function getStaticPaths() {
  return LANGS.map((lang) => ({ params: { lang } }));
}

export function GET({ params }) {
  const { lang } = params;
  const items = getStories().slice(0, 3000).map((s) => ({
    t: s[lang].title,
    s: s[lang].summary,
    u: storyUrl(lang, s),
    d: s.date,
    i: s.islands,
    p: s.topic,
    st: s.status,
    g: s.groups.length,
    im: s.image?.url ?? '',
  }));
  return new Response(JSON.stringify(items), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
