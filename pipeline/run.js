// Ejecución completa: descargar → agrupar → contrastar y redactar → guardar.
//   npm run update        (con IA)
//   npm run update:dry    (sin IA: solo descarga y agrupa por similitud, no publica nada nuevo)

import { fetchAllFeeds, enrichMissingSummaries, fetchPageMeta } from './fetch.js';
import { clusterArticles } from './cluster.js';
import { writeStory, wrongLanguage } from './writer.js';
import { loadStore, saveStore, archiveOld } from './store.js';
import { AI } from './ai.js';
import { findAndMergeDuplicates } from './dedupe.js';
import { SOURCE_BY_ID } from './sources.js';
import { hash, slugify } from './text.js';

const env = process.env;
const NO_AI = process.argv.includes('--no-ai');
const CFG = {
  maxClusterPerRun: Number(env.MAX_CLUSTER_PER_RUN ?? 120),
  maxWritesPerRun: Number(env.MAX_WRITES_PER_RUN ?? 25),
  singleSourceDelayMin: Number(env.SINGLE_SOURCE_DELAY_MIN ?? 60),
  timeBudgetMin: Number(env.TIME_BUDGET_MIN ?? 12),
  retentionDays: Number(env.RETENTION_DAYS ?? 30),
  articleTtlDays: 4,
  maxGroupsForRewrite: 4,
};

const t0 = Date.now();
const log = (...a) => console.log(...a);
const elapsedMin = () => (Date.now() - t0) / 60000;
const groupOf = (sourceId) => SOURCE_BY_ID[sourceId]?.group ?? sourceId;
const groupsOf = (story) => [...new Set(story.articles.map((a) => groupOf(a.sourceId)))];

function computeStatus(story) {
  if (story.contradiction && story.discrepancies?.length) return 'disputed';
  return groupsOf(story).length >= 2 ? 'verified' : 'single';
}

log(`\n▶ Horizonte Balear — ${new Date().toISOString()}${NO_AI ? ' (sin IA)' : ''}`);
const store = await loadStore();
const articleById = new Map(store.articles.map((a) => [a.id, a]));
const storyById = new Map(store.stories.map((s) => [s.id, s]));

// 1. Descargar
log('1) Descargando feeds…');
const { items, stats } = await fetchAllFeeds({ maxAgeHours: 48, log });
const fresh = items.filter((i) => !articleById.has(i.id));
for (const i of items) {
  const known = articleById.get(i.id);
  if (known && !known.image && i.image) known.image = i.image;
}
log(`   ${items.length} noticias locales en feeds, ${fresh.length} nuevas`);
await enrichMissingSummaries(fresh, { limit: 80 });
for (const a of fresh) {
  a.status = 'pending';
  a.fetchedAt = new Date().toISOString();
  articleById.set(a.id, a);
}

// 2. Agrupar
const ai = new AI({ log });
if (NO_AI) ai.providers = [];
if (ai.enabled) {
  const models = await ai.init();
  log(`   IA disponible → ${models.join(' | ') || 'ninguna'}`);
} else log('   ⚠ Sin claves de IA: no se redactarán noticias nuevas.');

const pending = [...articleById.values()]
  .filter((a) => a.status === 'pending' && Date.now() - Date.parse(a.published) < 48 * 3600e3)
  .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
  .slice(0, CFG.maxClusterPerRun);
log(`2) Agrupando ${pending.length} artículos…`);
const liveStories = store.stories.filter((s) => !s.mergedInto && Date.now() - Date.parse(s.createdAt) < 7 * 86400e3);
const assignments = await clusterArticles(pending, liveStories, { ai, log });

const newStories = new Map();
let attached = 0;
let irrelevant = 0;
for (const a of pending) {
  if (!assignments.has(a.id)) continue;
  const ref = assignments.get(a.id);
  if (ref === null) { a.status = 'irrelevant'; irrelevant++; continue; }
  let story = ref.storyId ? storyById.get(ref.storyId) : newStories.get(ref.newKey);
  while (story?.mergedInto && storyById.has(story.mergedInto)) story = storyById.get(story.mergedInto);
  if (!story) {
    story = { id: `st${hash(a.id + Date.now(), 10)}`, createdAt: new Date().toISOString(), firstPublished: a.published, articles: [], needsWrite: true };
    newStories.set(ref.newKey, story);
    storyById.set(story.id, story);
  } else attached++;
  const groupsBefore = groupsOf(story);
  if (!story.articles.some((x) => x.id === a.id || x.url === a.url)) {
    story.articles.push({ id: a.id, url: a.url, sourceId: a.sourceId, lang: a.lang, title: a.title, published: a.published });
  }
  story.lastArticleAt = [story.lastArticleAt, a.published].filter(Boolean).sort().at(-1);
  if (Date.parse(a.published) < Date.parse(story.firstPublished ?? a.published)) story.firstPublished = a.published;
  const g = groupOf(a.sourceId);
  if (!story.hidden && (!story.es || (!groupsBefore.includes(g) && groupsBefore.length < CFG.maxGroupsForRewrite))) story.needsWrite = true;
  a.status = 'clustered';
  a.storyId = story.id;
}
log(`   ${newStories.size} historias nuevas, ${attached} artículos añadidos a historias existentes, ${irrelevant} descartados`);

// 2b. Fusionar historias duplicadas (mismo hecho en dos historias)
log('   Buscando noticias duplicadas…');
await findAndMergeDuplicates([...storyById.values()], { ai, log, groupOf });

// 3. Contrastar y redactar
// Autocorrección: si una noticia ya publicada tiene el texto en el idioma equivocado, se vuelve a redactar.
for (const s of storyById.values()) {
  if (s.es && !s.hidden && !s.needsWrite && (wrongLanguage('es', s.es) || wrongLanguage('ca', s.ca))) s.needsWrite = true;
}
const candidates = [...storyById.values()]
  .filter((s) => s.needsWrite && !s.hidden)
  .filter((s) => groupsOf(s).length >= 2 || s.es || Date.now() - Date.parse(s.firstPublished ?? s.createdAt) >= CFG.singleSourceDelayMin * 60000)
  .sort((a, b) => groupsOf(b).length - groupsOf(a).length || Date.parse(b.lastArticleAt) - Date.parse(a.lastArticleAt));
const waiting = [...storyById.values()].filter((s) => s.needsWrite && !s.hidden).length - candidates.length;
log(`3) Contrastando y redactando: ${candidates.length} listas${waiting ? `, ${waiting} esperando a más fuentes` : ''}`);

let written = 0;
for (const story of candidates) {
  if (!ai.enabled) break;
  if (ai.exhaustedAll) { log('   ⏸ Cuota de IA agotada: el resto queda para la próxima ejecución'); break; }
  if (written >= CFG.maxWritesPerRun || elapsedMin() > CFG.timeBudgetMin) { log('   ⏸ Límite de esta ejecución alcanzado'); break; }
  const withSummaries = story.articles.map((x) => ({ ...x, summary: articleById.get(x.id)?.summary ?? '' }));
  try {
    const r = await writeStory({ ...story, articles: withSummaries }, { ai });
    story.needsWrite = false;
    story.model = r.model;
    story.writtenAt = new Date().toISOString();
    if (!r.relevant) { story.hidden = true; log(`   – descartada: ${story.articles[0].title.slice(0, 80)}`); continue; }
    Object.assign(story, {
      islands: r.islands.length ? r.islands : ['baleares'],
      topic: r.topic,
      es: r.es,
      ca: r.ca,
      facts: r.facts,
      discrepancies: r.discrepancies,
      contradiction: r.contradiction,
      updatedAt: new Date().toISOString(),
    });
    story.slug ??= `${slugify(r.es.title, 70)}-${story.id.slice(-5)}`;
    story.status = computeStatus(story);
    written++;
    log(`   ✓ [${story.status}] (${groupsOf(story).length} grupos) ${r.es.title}`);
  } catch (e) {
    story.writeErrors = (story.writeErrors ?? 0) + 1;
    log(`   ✖ ${story.articles[0].title.slice(0, 70)} → ${e.message.slice(0, 200)}`);
    if (story.writeErrors >= 3) { story.needsWrite = false; if (!story.es) story.hidden = true; }
  }
}
for (const s of storyById.values()) if (s.es) s.status = computeStatus(s);

// 4. Fotos: se usa la foto publicada por uno de los medios, con crédito y enlace al original.
const IMAGE_PRIORITY = ['diariodemallorca', 'diariodeibiza', 'ultimahora', 'arabalears', 'cronicabalear', 'periodicodeibiza', 'menorcainfo', 'europapress', 'elmundobaleares', 'dbalears', 'noudiari', 'mallorcadiario', 'ib3'];
const rankSource = (id) => { const i = IMAGE_PRIORITY.indexOf(id); return i < 0 ? 99 : i; };
let ogFetches = 0;
for (const story of storyById.values()) {
  if (story.image && SOURCE_BY_ID[story.image.sourceId]?.allowImages === false) delete story.image;
  if (!story.es || story.hidden || story.image) continue;
  const arts = [...story.articles].filter((a) => SOURCE_BY_ID[a.sourceId]?.allowImages !== false).sort((a, b) => rankSource(a.sourceId) - rankSource(b.sourceId));
  let pick = arts.map((a) => ({ a, img: articleById.get(a.id)?.image })).find((x) => x.img);
  for (const a of arts) {
    if (pick || ogFetches >= 40) break;
    ogFetches++;
    try {
      const { image } = await fetchPageMeta(a.url);
      if (image) pick = { a, img: image };
    } catch { /* sin foto */ }
  }
  if (pick) story.image = { url: pick.img, sourceId: pick.a.sourceId, articleUrl: pick.a.url };
}

// 5. Guardar
const articleLimit = Date.now() - CFG.articleTtlDays * 86400e3;
const articles = [...articleById.values()].filter((a) => Date.parse(a.fetchedAt ?? a.published) >= articleLimit);
const stories = [...storyById.values()].filter((s) => s.es || (!s.hidden && Date.now() - Date.parse(s.createdAt) < 3 * 86400e3) || (s.hidden && Date.now() - Date.parse(s.createdAt) < 7 * 86400e3));
const { keep, archived } = await archiveOld(stories, CFG.retentionDays);
keep.sort((a, b) => Date.parse(b.firstPublished ?? b.createdAt) - Date.parse(a.firstPublished ?? a.createdAt));

const prevMeta = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../data/meta.json', import.meta.url), 'utf8').then(JSON.parse).catch(() => ({})));
const meta = {
  lastRun: new Date().toISOString(),
  lastPublishAt: written ? new Date().toISOString() : prevMeta.lastPublishAt ?? null,
  run: { fetched: items.length, new: fresh.length, clustered: assignments.size, written, archived, minutes: Number(elapsedMin().toFixed(1)) },
  sources: stats,
  aiUsage: ai.usage,
};
if (NO_AI) log('  (modo prueba: no se guardan cambios)');
else await saveStore({ articles, stories: keep }, meta);
log(`✔ Fin en ${elapsedMin().toFixed(1)} min — ${written} noticias redactadas, ${keep.filter((s) => s.es && !s.hidden).length} publicadas en total`);
log(`  Uso de IA: ${JSON.stringify(ai.usage)}`);
