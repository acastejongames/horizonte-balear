// Contrasta las versiones de los distintos medios y redacta la noticia propia
// (castellano y catalán), citando siempre las fuentes originales.

import { SOURCE_BY_ID, ISLANDS, TOPICS } from './sources.js';
import { truncate } from './text.js';

// Modelos preferidos para redactar (mejor catalán). Si no existen o se agotan, se usan los demás.
const WRITER_MODELS = (process.env.WRITER_MODELS || 'qwen/qwen3.8-27b,gemini-flash-latest').split(',').map((s) => s.trim()).filter(Boolean);

const SYSTEM = `Eres periodista y verificador de datos en una redacción de las Islas Baleares.
Recibes las versiones que distintos medios han publicado sobre UN MISMO HECHO.
Tu trabajo:
1. CONTRASTAR: identifica los datos concretos (cifras, nombres, lugares, fechas, horas,
   resultados, cargos) y comprueba si las fuentes coinciden. Una discrepancia es una
   CONTRADICCIÓN real entre fuentes (p. ej. "3 heridos" frente a "5 heridos"); que una fuente
   dé más detalles que otra NO es una discrepancia.
2. REDACTAR una noticia original y neutral, en castellano y en catalán (normativo, se admiten
   formas baleares), usando EXCLUSIVAMENTE la información de las fuentes.
   - No inventes ni supongas nada. No añadas contexto que no esté en las fuentes.
   - No copies frases literales de los medios: redacta con tus propias palabras.
   - Si un dato solo lo da un medio, atribúyelo ("según Última Hora…").
   - Si hay datos contradictorios, menciónalo en el texto con las dos versiones.
   - Tono informativo, sin adjetivos valorativos ni sensacionalismo. Titular claro y factual,
     con artículo inicial ("Un juez…", "El Govern…").
3. CATALÀ: escriu en català normatiu i natural, no una traducció literal del castellà.
   Apòstrofs correctes (l', d', s'), sense castellanismes: desnonament (no "expulsió"),
   lloguer, veïna, "fa 60 anys que hi viu" (no "porta 60 anys vivint"), "a causa de" (no "degut a"),
   "la seva llar", "l'esport".
Responde SOLO con JSON válido.`;

function userPrompt(sources) {
  const blocks = sources
    .map((s) => `[${s.key}] ${s.name} (${s.lang}) — ${s.published.slice(0, 16).replace('T', ' ')}
Titular: ${s.title}
Texto: ${s.summary || '(solo titular)'}`)
    .join('\n\n');
  return `FUENTES:
${blocks}

Campos:
- relevant: false si no trata de Baleares o es opinión/publicidad.
- islands: una o varias de ${ISLANDS.join(', ')} ("baleares" si afecta a todas las islas o al Govern).
- topic: una de ${TOPICS.join(', ')}. Guía: sucesos = detenciones, agresiones, robos, accidentes,
  incendios, rescates, desapariciones; tribunales = juicios, sentencias, autos, investigaciones judiciales;
  politica = gobiernos, partidos, plenos, elecciones; sociedad = solo si no encaja en ninguna otra.
- es: noticia en CASTELLANO (aunque las fuentes estén en catalán). title: máx. 110 caracteres. summary: entradilla de 1-2 frases.
  body: 2-4 párrafos, entre 100 y 220 palabras en total.
- ca: la misma noticia en CATALÁN (aunque las fuentes estén en castellano), con la misma estructura.
- facts: 2-5 datos clave y las claves de las fuentes (F1, F2…) que los recogen.
- discrepancies: contradicciones entre fuentes, indicando qué dice cada una ([] si no hay).
- contradiction: true solo si hay contradicciones relevantes entre fuentes.

Devuelve exactamente este formato JSON (sin comentarios):
{"relevant":true,"islands":["mallorca"],"topic":"sociedad","es":{"title":"...","summary":"...","body":["...","..."]},"ca":{"title":"...","summary":"...","body":["...","..."]},"facts":[{"es":"...","ca":"...","sources":["F1","F2"]}],"discrepancies":[],"contradiction":false}`;
}

/** Elige como máximo `max` fuentes, priorizando una por medio y por grupo. */
function selectSources(articles, max = 6) {
  const sorted = [...articles].sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
  const out = [];
  const seenSource = new Set();
  const seenGroup = new Set();
  for (const pass of [0, 1]) {
    for (const a of sorted) {
      if (out.length >= max || out.includes(a)) continue;
      const src = SOURCE_BY_ID[a.sourceId];
      if (pass === 0 && (seenGroup.has(src?.group) || seenSource.has(a.sourceId))) continue;
      if (pass === 1 && seenSource.has(a.sourceId)) continue;
      out.push(a);
      seenSource.add(a.sourceId);
      seenGroup.add(src?.group);
    }
  }
  return out;
}

const clean = (s, max) => truncate(String(s ?? '').replace(/\s+/g, ' ').trim(), max);

// Algunos modelos devuelven el cuerpo como texto en lugar de lista, o con otros nombres de campo.
function normalizeLang(x) {
  if (!x || typeof x !== 'object') return x;
  const body = x.body ?? x.text ?? x.paragraphs ?? x.cuerpo ?? x.cos;
  return {
    title: x.title ?? x.titular ?? x.titol,
    summary: x.summary ?? x.entradilla ?? x.lead ?? '',
    body: Array.isArray(body) ? body : typeof body === 'string' ? body.split(/\n\s*\n|\n/).filter((p) => p.trim()) : [],
  };
}

// Comprobación sencilla de idioma para detectar textos en el idioma equivocado.
const CA_MARKERS = /(^|[\s(])(amb|els|dels|als|pels|perquè|aquest|aquesta|també|seva|seu|fins|una vegada|l'|d'|s'|n')(?=[\s\wàèéíòóú])/gi;
const ES_MARKERS = /(^|[\s(])(con|los|las|para|también|según|tras|desde|hasta|está|había|ayer|sus)(?=\s)/gi;
const count = (re, s) => (String(s).match(re) || []).length;
export function wrongLanguage(lang, x) {
  const text = `${x.title} ${x.summary} ${x.body.join(' ')}`;
  const ca = count(CA_MARKERS, text);
  const es = count(ES_MARKERS, text);
  return lang === 'es' ? ca > es + 2 : es > ca + 2;
}

function validLang(x) {
  return x && typeof x.title === 'string' && x.title.trim() && Array.isArray(x.body) && x.body.length;
}

/** Redacta y contrasta una historia. Devuelve los campos editoriales o lanza error. */
export async function writeStory(story, { ai }) {
  const chosen = selectSources(story.articles);
  const sources = chosen.map((a, i) => ({
    key: `F${i + 1}`,
    name: SOURCE_BY_ID[a.sourceId]?.name ?? a.sourceId,
    lang: a.lang,
    published: a.published,
    title: a.title,
    summary: truncate(a.summary, 650),
    sourceId: a.sourceId,
  }));
  const { data, model } = await ai.json({ system: SYSTEM, user: userPrompt(sources), maxTokens: 2400, temperature: 0.2, prefer: WRITER_MODELS });

  if (data.relevant === false) return { relevant: false, model };
  data.es = normalizeLang(data.es ?? data.castellano ?? data.spanish);
  data.ca = normalizeLang(data.ca ?? data.catala ?? data.catalan);
  if (!validLang(data.es) || !validLang(data.ca)) {
    throw new Error(`Respuesta incompleta de ${model}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  if (wrongLanguage('es', data.es) || wrongLanguage('ca', data.ca)) throw new Error(`Idioma equivocado en la respuesta de ${model}`);

  const keyToSource = Object.fromEntries(sources.map((s) => [s.key, s.sourceId]));
  const mapSources = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map((k) => keyToSource[String(k).toUpperCase()]).filter(Boolean))];
  const lang = (x) => ({
    title: clean(x.title, 140),
    summary: clean(x.summary, 400),
    body: x.body.map((p) => String(p).trim()).filter(Boolean).slice(0, 6),
  });

  return {
    relevant: true,
    model,
    islands: (Array.isArray(data.islands) ? data.islands : [data.islands]).map((i) => String(i).toLowerCase()).filter((i) => ISLANDS.includes(i)),
    topic: TOPICS.includes(String(data.topic).toLowerCase()) ? String(data.topic).toLowerCase() : 'sociedad',
    es: lang(data.es),
    ca: lang(data.ca),
    facts: (data.facts ?? []).filter((f) => f?.es).slice(0, 6).map((f) => ({ es: clean(f.es, 300), ca: clean(f.ca ?? f.es, 300), sources: mapSources(f.sources) })),
    discrepancies: (data.discrepancies ?? []).filter((d) => d?.es).slice(0, 5).map((d) => ({ es: clean(d.es, 400), ca: clean(d.ca ?? d.es, 400), sources: mapSources(d.sources) })),
    contradiction: data.contradiction === true,
    usedSources: sources.map((s) => s.sourceId),
  };
}
