// Fusión de noticias duplicadas.
// A veces el mismo hecho acaba en dos historias (p. ej. una agrupó los medios en catalán y otra
// los de castellano). Como todas las historias publicadas tienen ya un titular y una entradilla en
// castellano redactados por la IA, se pueden comparar bien entre sí:
//   1) similitud de palabras para encontrar parejas candidatas (barato)
//   2) la IA confirma qué parejas cuentan realmente el mismo hecho
//   3) se fusionan: la historia absorbida se oculta y redirige a la que queda

import { tokens, similarity } from './text.js';

const SYSTEM = `Eres editor de una agencia de noticias de Baleares. Te paso parejas de noticias.
Indica cuáles cuentan el MISMO hecho concreto (mismo suceso, misma decisión, mismo anuncio).
SÍ son el mismo hecho:
- dos versiones del mismo anuncio aunque una se centre en una isla o en un detalle
  (misma cifra, mismo organismo, mismo día);
- dos versiones del mismo suceso con más o menos detalles.
NO son el mismo hecho:
- hechos parecidos pero distintos (dos accidentes diferentes, dos plenos distintos);
- un seguimiento posterior con un hecho nuevo (p. ej. el accidente y, al día siguiente,
  la detención del conductor);
- la reacción o declaración de un tercero sobre un hecho (un sindicato que denuncia, un
  partido que critica) frente al hecho en sí.
Responde SOLO con JSON.`;

const textOf = (s) => `${s.es.title}. ${s.es.summary}`;

export async function findAndMergeDuplicates(stories, { ai, log = console.log, groupOf, maxPairs = 25 } = {}) {
  const now = Date.now();
  const live = stories.filter((s) => s.es && !s.hidden && now - Date.parse(s.lastArticleAt ?? s.createdAt) < 4 * 86400e3);
  const tok = new Map(live.map((s) => [s.id, tokens(textOf(s))]));

  const candidates = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (a.distinctFrom?.includes(b.id) || b.distinctFrom?.includes(a.id)) continue;
      if (Math.abs(Date.parse(a.firstPublished ?? a.createdAt) - Date.parse(b.firstPublished ?? b.createdAt)) > 3 * 86400e3) continue;
      const score = similarity(tok.get(a.id), tok.get(b.id));
      if (score >= 0.2) candidates.push({ a, b, score });
    }
  }
  if (!candidates.length) return 0;
  candidates.sort((x, y) => y.score - x.score);
  const pairs = candidates.slice(0, maxPairs);

  let same = new Set();
  if (ai?.enabled && !ai.exhaustedAll) {
    const list = pairs.map((p, i) => `P${i + 1}:\n  A: ${textOf(p.a)}\n  B: ${textOf(p.b)}`).join('\n');
    try {
      const { data, model } = await ai.json({
        system: SYSTEM,
        user: `${list}\n\nDevuelve {"same":["P1", ...]} con las parejas que son el mismo hecho ([] si ninguna).`,
        maxTokens: 800,
        temperature: 0,
      });
      same = new Set((data.same ?? []).map((k) => String(k).toUpperCase()));
      log(`   ${pairs.length} parejas revisadas, ${same.size} duplicadas (${model})`);
    } catch (e) {
      log(`   ⚠ no se pudo revisar duplicados con IA (${e.message.slice(0, 120)})`);
      return 0;
    }
  } else {
    pairs.forEach((p, i) => { if (p.score >= 0.6) same.add(`P${i + 1}`); });
  }

  let merged = 0;
  pairs.forEach((p, i) => {
    const key = `P${i + 1}`;
    if (!same.has(key)) {
      // Se recuerda que son distintas para no volver a preguntar.
      (p.a.distinctFrom ??= []).push(p.b.id);
      return;
    }
    if (p.a.hidden || p.b.hidden) return; // ya fusionada en esta misma pasada
    // Se conserva la que tiene más grupos independientes (o la más antigua).
    const groups = (s) => new Set(s.articles.map((x) => groupOf(x.sourceId))).size;
    const [keep, drop] = groups(p.a) > groups(p.b) || (groups(p.a) === groups(p.b) && Date.parse(p.a.createdAt) <= Date.parse(p.b.createdAt)) ? [p.a, p.b] : [p.b, p.a];
    for (const art of drop.articles) {
      if (!keep.articles.some((x) => x.id === art.id || x.url === art.url)) keep.articles.push(art);
    }
    keep.lastArticleAt = [keep.lastArticleAt, drop.lastArticleAt].filter(Boolean).sort().at(-1);
    if (Date.parse(drop.firstPublished ?? drop.createdAt) < Date.parse(keep.firstPublished ?? keep.createdAt)) keep.firstPublished = drop.firstPublished;
    keep.needsWrite = true; // se vuelve a contrastar con todas las fuentes
    drop.hidden = true;
    drop.mergedInto = keep.id;
    drop.needsWrite = false;
    merged++;
    log(`   ⇄ fusionada: «${drop.es.title.slice(0, 60)}» → «${keep.es.title.slice(0, 60)}»`);
  });
  return merged;
}
