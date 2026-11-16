// Agrupa artículos de distintos medios que cuentan el MISMO hecho.
// 1) La IA decide (entiende castellano y catalán, sinónimos, etc.).
// 2) Si no hay IA disponible, se usa una similitud léxica como respaldo.

import { SOURCE_BY_ID } from './sources.js';
import { tokens, similarity, truncate, hash } from './text.js';

const SYSTEM = `Eres el editor jefe de una agencia de noticias de las Islas Baleares.
Tu tarea es agrupar artículos de distintos medios que informan del MISMO HECHO CONCRETO
(el mismo suceso, la misma decisión, el mismo partido, el mismo anuncio), aunque estén
escritos en castellano o en catalán y con palabras distintas.
No agrupes artículos que solo comparten tema general (p. ej. dos accidentes distintos,
dos plenos distintos). Ante la duda, NO agrupes.
Marca relevant=false si el artículo: no trata de Baleares ni afecta directamente a Baleares;
es una columna de opinión, carta, editorial, horóscopo, contenido patrocinado, sorteo,
pasatiempo, esquela, guía de compras, galería de fotos, previa/agenda de ocio o una
retransmisión "en directo" sin hechos concretos.
Responde SOLO con JSON válido.`;

function userPrompt(stories, articles) {
  const s = stories.length
    ? stories.map((st) => `${st.key} | ${st.date} | ${st.title}`).join('\n')
    : '(ninguna)';
  const a = articles
    .map((ar) => `${ar.key} | ${SOURCE_BY_ID[ar.sourceId]?.name ?? ar.sourceId} | ${ar.published.slice(0, 16).replace('T', ' ')} | ${ar.title} — ${truncate(ar.summary, 220)}`)
    .join('\n');
  return `HISTORIAS YA PUBLICADAS (clave | fecha | titular):
${s}

ARTÍCULOS NUEVOS (clave | medio | fecha | titular — extracto):
${a}

Para CADA artículo nuevo indica:
- "relevant": true/false (ver criterios).
- "story": la clave S… de la historia existente que cuenta el mismo hecho, o null.
- "group": si no encaja en ninguna historia existente, una etiqueta "N1", "N2"… compartida
  por los artículos nuevos que cuentan el mismo hecho entre sí (cada hecho distinto, etiqueta distinta).

Formato exacto:
{"items":[{"a":"A1","relevant":true,"story":null,"group":"N1"},{"a":"A2","relevant":true,"story":"S3","group":null}]}`;
}

function storyTitle(st) {
  return st.es?.title ?? st.articles[0]?.title ?? '';
}

function pickCandidateStories(batch, stories, maxRecent = 45, maxSimilar = 20) {
  const now = Date.now();
  const recent = stories
    .filter((s) => now - Date.parse(s.lastArticleAt ?? s.createdAt) < 36 * 3600e3)
    .sort((a, b) => Date.parse(b.lastArticleAt ?? b.createdAt) - Date.parse(a.lastArticleAt ?? a.createdAt))
    .slice(0, maxRecent);
  const chosen = new Set(recent);
  const batchTokens = batch.map((a) => tokens(`${a.title} ${a.summary.slice(0, 300)}`));
  const scored = stories
    .filter((s) => !chosen.has(s) && now - Date.parse(s.createdAt) < 7 * 86400e3)
    .map((s) => {
      const t = tokens(storyTitle(s) + ' ' + s.articles.map((x) => x.title).join(' '));
      return { s, score: Math.max(...batchTokens.map((bt) => similarity(bt, t))) };
    })
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSimilar);
  for (const x of scored) chosen.add(x.s);
  return [...chosen];
}

/**
 * Asigna cada artículo nuevo a una historia (existente o nueva).
 * Devuelve { assignments: Map<articleId, storyRef|null>, newGroups } donde storyRef es
 * { storyId } para historias existentes o { newKey } para historias nuevas.
 */
export async function clusterArticles(articles, stories, { ai, log = console.log, batchSize = 20 } = {}) {
  const result = new Map(); // articleId -> { storyId } | { newKey } | null (irrelevante)
  if (!articles.length) return result;

  if (!ai?.enabled) return lexicalCluster(articles, stories);

  // Historias nuevas creadas en lotes anteriores de esta misma ejecución: los lotes
  // siguientes también deben poder unirse a ellas.
  const provisional = new Map(); // newKey -> pseudo-historia
  const refOf = (s) => (s.newKey ? { newKey: s.newKey } : { storyId: s.id });
  const remember = (a, newKey) => {
    let p = provisional.get(newKey);
    if (!p) {
      p = { id: `new:${newKey}`, newKey, createdAt: new Date().toISOString(), lastArticleAt: a.published, articles: [] };
      provisional.set(newKey, p);
    }
    p.articles.push({ title: a.title });
  };

  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize).map((a, j) => ({ ...a, key: `A${j + 1}` }));
    const pool = [...pickCandidateStories(batch, stories, 35, 15), ...pickProvisional(batch, [...provisional.values()])];
    const cands = pool.map((s, j) => ({
      key: `S${j + 1}`,
      ref: refOf(s),
      date: (s.lastArticleAt ?? s.createdAt).slice(0, 10),
      title: storyTitle(s),
    }));
    try {
      const { data, model } = await ai.json({ system: SYSTEM, user: userPrompt(cands, batch), maxTokens: 2500, temperature: 0 });
      const byKey = Object.fromEntries((data.items ?? []).map((x) => [String(x.a).toUpperCase(), x]));
      const batchTag = hash(`${Date.now()}-${i}`, 6);
      let answered = 0;
      for (const a of batch) {
        const r = byKey[a.key];
        if (!r) continue; // sin respuesta: se reintentará en la próxima ejecución
        answered++;
        if (r.relevant === false) { result.set(a.id, null); continue; }
        const st = r.story ? cands.find((c) => c.key === String(r.story).toUpperCase()) : null;
        const ref = st ? st.ref : { newKey: `${batchTag}-${r.group ?? a.key}` };
        result.set(a.id, ref);
        if (ref.newKey) remember(a, ref.newKey);
      }
      log(`  · lote ${i / batchSize + 1}: ${answered}/${batch.length} artículos clasificados (${model})`);
    } catch (e) {
      log(`  ⚠ agrupación con IA falló (${e.message.slice(0, 160)}); uso similitud léxica`);
      for (const [id, ref] of lexicalCluster(batch, pool)) {
        result.set(id, ref);
        if (ref.newKey) remember(batch.find((a) => a.id === id), ref.newKey);
      }
    }
  }
  return result;
}

function pickProvisional(batch, provisional, max = 25) {
  if (!provisional.length) return [];
  const batchTokens = batch.map((a) => tokens(`${a.title} ${a.summary.slice(0, 300)}`));
  const scored = provisional
    .map((p, idx) => ({ p, idx, score: Math.max(...batchTokens.map((bt) => similarity(bt, tokens(p.articles.map((x) => x.title).join(' '))))) }))
    .sort((a, b) => b.score - a.score);
  const chosen = new Set(scored.filter((x) => x.score >= 0.15).slice(0, max - 10).map((x) => x.p));
  for (const p of provisional.slice(-10)) chosen.add(p); // las más recientes, por si el idioma difiere
  return [...chosen].slice(0, max);
}

/** Respaldo sin IA: agrupa por similitud de palabras del titular y extracto. */
export function lexicalCluster(articles, stories, threshold = 0.5) {
  const result = new Map();
  const pool = stories
    .filter((s) => Date.now() - Date.parse(s.createdAt) < 3 * 86400e3)
    .map((s) => ({ ref: s.newKey ? { newKey: s.newKey } : { storyId: s.id }, t: tokens(storyTitle(s) + ' ' + s.articles.map((x) => x.title).join(' ')) }));
  for (const a of articles) {
    const t = tokens(`${a.title} ${a.summary.slice(0, 200)}`);
    let best = null;
    let bestScore = threshold;
    for (const p of pool) {
      const sc = similarity(t, p.t);
      if (sc >= bestScore) { best = p; bestScore = sc; }
    }
    if (best) { result.set(a.id, best.ref); best.t = [...new Set([...best.t, ...t])]; }
    else {
      const ref = { newKey: `lex-${a.id}` };
      result.set(a.id, ref);
      pool.push({ ref, t });
    }
  }
  return result;
}
