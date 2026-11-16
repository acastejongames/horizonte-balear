import { createHash } from 'node:crypto';

export const hash = (s, len = 12) => createHash('sha1').update(String(s)).digest('hex').slice(0, len);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', laquo: '«', raquo: '»', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·', euro: '€' };

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function stripHtml(s) {
  return decodeEntities(
    decodeEntities(String(s ?? ''))
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function truncate(s, max) {
  s = String(s ?? '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return (lastStop > max * 0.6 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/, '') + '…').trim();
}

export function fold(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/l·l/g, 'll');
}

export function slugify(s, max = 80) {
  let out = fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (out.length > max) out = out.slice(0, max).replace(/-[^-]*$/, '');
  return out || 'noticia';
}

// Palabras vacías en castellano y catalán (para comparar textos).
const STOP = new Set(`a al algo als amb ante antes aquest aquesta aqui aquí as aun cada como con contra cual cuando d da de del dels des desde despues després dins donde dos durante e el els ella ellos en entre era es esa ese esta este esto estos fa fins fue fueron ha han hay hi i la las le les lo los mas més me mes mi molt muy n na ni no nos o os otra otro pa para pel per pero perque perquè poco por porque pot que qué quan quien s sa se segun ser ses si sin sobre son sota su sus també también tan te tiene tot tots tras tu un una uno unos va van y ya ja ho hem han sido será serà ser ha haber hace fa dia día dies días año any anys años nuevo nou nova nueva`.split(/\s+/).map(fold));

export function tokens(s) {
  return [...new Set(fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))];
}

// Similaridad entre dos conjuntos de tokens (coeficiente de solapamiento suavizado).
export function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  let inter = 0;
  for (const w of a) if (B.has(w)) inter++;
  return inter / Math.sqrt(a.length * b.length);
}
