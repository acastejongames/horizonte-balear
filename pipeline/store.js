import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const ARCHIVE_DIR = join(DATA_DIR, 'archive');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 1) + '\n', 'utf8');
}

export async function loadStore() {
  return {
    articles: await readJson(join(DATA_DIR, 'articles.json'), []),
    stories: await readJson(join(DATA_DIR, 'stories.json'), []),
  };
}

export async function saveStore({ articles, stories }, meta) {
  await writeJson(join(DATA_DIR, 'articles.json'), articles);
  await writeJson(join(DATA_DIR, 'stories.json'), stories);
  if (meta) await writeJson(join(DATA_DIR, 'meta.json'), meta);
}

/** Mueve las historias antiguas a data/archive/AAAA-MM.json (se siguen publicando en la web). */
export async function archiveOld(stories, retentionDays) {
  const limit = Date.now() - retentionDays * 86400e3;
  const keep = [];
  const byMonth = {};
  for (const s of stories) {
    if (Date.parse(s.lastArticleAt ?? s.createdAt) >= limit) keep.push(s);
    else if (s.es && (!s.hidden || s.mergedInto)) (byMonth[s.createdAt.slice(0, 7)] ??= []).push(s); // las fusionadas se guardan para redirigir
  }
  for (const [month, list] of Object.entries(byMonth)) {
    const file = join(ARCHIVE_DIR, `${month}.json`);
    const existing = await readJson(file, []);
    const ids = new Set(list.map((s) => s.id));
    await writeJson(file, [...existing.filter((s) => !ids.has(s.id)), ...list]);
  }
  return { keep, archived: Object.values(byMonth).flat().length };
}

export async function loadArchive() {
  let files = [];
  try {
    files = (await readdir(ARCHIVE_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const all = await Promise.all(files.map((f) => readJson(join(ARCHIVE_DIR, f), [])));
  return all.flat();
}
