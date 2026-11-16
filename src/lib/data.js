import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SOURCES, SOURCE_BY_ID } from '../../pipeline/sources.js';

const DATA = join(process.cwd(), 'data');
const readJson = (f, fb) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fb);

let cache;
let cacheKey;
let rawCache = [];

/** Historias publicadas (redactadas y relevantes), de la más reciente a la más antigua. */
export function getStories() {
  const file = join(DATA, 'stories.json');
  const key = existsSync(file) ? statSync(file).mtimeMs : 0; // se recarga si cambian los datos (modo dev)
  if (cache && key === cacheKey) return cache;
  cacheKey = key;
  const archiveDir = join(DATA, 'archive');
  const archived = existsSync(archiveDir)
    ? readdirSync(archiveDir).filter((f) => f.endsWith('.json')).flatMap((f) => readJson(join(archiveDir, f), []))
    : [];
  const seen = new Set();
  const raw = [...readJson(join(DATA, 'stories.json'), []), ...archived];
  rawCache = raw;
  cache = raw
    .filter((s) => s.es && s.ca && s.slug && !s.hidden && !seen.has(s.id) && seen.add(s.id))
    .map((s) => {
      const groups = [...new Set(s.articles.map((a) => SOURCE_BY_ID[a.sourceId]?.group ?? a.sourceId))];
      const media = [...new Set(s.articles.map((a) => a.sourceId))];
      return { ...s, date: s.firstPublished ?? s.createdAt, groups, media, islands: s.islands?.length ? s.islands : ['baleares'] };
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return cache;
}

/** Noticias fusionadas en otra: su dirección antigua redirige a la que queda. */
export function getRedirects() {
  const published = new Map(getStories().map((s) => [s.id, s]));
  const byId = new Map(rawCache.map((s) => [s.id, s]));
  const out = [];
  for (const s of rawCache) {
    if (!s.mergedInto || !s.slug) continue;
    let target = byId.get(s.mergedInto);
    for (let i = 0; target?.mergedInto && i < 5; i++) target = byId.get(target.mergedInto);
    const live = target && published.get(target.id);
    if (live && live.slug !== s.slug && !published.has(s.id)) out.push({ from: s.slug, to: live });
  }
  return out;
}

export const getMeta = () => readJson(join(DATA, 'meta.json'), {});

export function sourceName(id) {
  return SOURCE_BY_ID[id]?.name ?? id;
}

export function storySources(story) {
  return [...story.articles]
    .sort((a, b) => Date.parse(a.published) - Date.parse(b.published))
    .map((a) => ({ ...a, name: sourceName(a.sourceId), group: SOURCE_BY_ID[a.sourceId]?.group }));
}

export function related(story, n = 4) {
  return getStories()
    .filter((s) => s.id !== story.id && (s.topic === story.topic || s.islands.some((i) => story.islands.includes(i))))
    .map((s) => ({ s, score: (s.topic === story.topic ? 2 : 0) + s.islands.filter((i) => story.islands.includes(i) && i !== 'baleares').length - Math.abs(Date.parse(s.date) - Date.parse(story.date)) / 86400e3 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.s);
}

/**
 * Portada organizada en bloques que no se repiten: cada noticia aparece una sola vez.
 *  - lead: la más contrastada (y con foto) de las últimas horas
 *  - top: las 4 siguientes más recientes
 *  - ranking: las más contrastadas del día (lista numerada)
 *  - more: siguientes recientes
 *  - byIsland: 3 por isla (para las pestañas)
 *  - rest: todo lo demás (con "ver más")
 */
export function frontPage() {
  const all = getStories();
  const now = Date.now();
  const used = new Set();
  const take = (list, n) => {
    const out = [];
    for (const s of list) {
      if (out.length >= n) break;
      if (!used.has(s.id)) { out.push(s); used.add(s.id); }
    }
    return out;
  };
  const recent = all.filter((s) => now - Date.parse(s.date) < 24 * 3600e3);
  const pool = recent.length >= 5 ? recent : all.slice(0, 30);
  const score = (s) => (s.image?.url ? 100 : 0) + s.groups.length * 10 - (now - Date.parse(s.date)) / 3600e3;
  const [lead] = take([...pool].sort((a, b) => score(b) - score(a)), 1);
  const top = take(all, 4);
  const ranking = take(
    pool.filter((s) => s.status === 'verified').sort((a, b) => b.groups.length - a.groups.length || Date.parse(b.date) - Date.parse(a.date)),
    5,
  );
  const more = take(all, 6);
  const byIsland = Object.fromEntries(
    ['mallorca', 'menorca', 'ibiza', 'formentera'].map((k) => [k, take(all.filter((s) => s.islands.includes(k)), 3)]),
  );
  const rest = take(all, 90);
  return { lead, top, ranking, more, byIsland, rest };
}

/** Las noticias de las últimas horas, para la barra de "Última hora". */
export function breakingNews() {
  const all = getStories();
  const recent = all.filter((s) => Date.now() - Date.parse(s.date) < 6 * 3600e3);
  return (recent.length >= 4 ? recent : all).slice(0, 8);
}

/** Foto de la noticia (publicada por uno de los medios) con su crédito. */
export function storyImage(story) {
  if (!story.image?.url || SOURCE_BY_ID[story.image.sourceId]?.allowImages === false) return null;
  return { ...story.image, credit: sourceName(story.image.sourceId) };
}

export { SOURCES };
