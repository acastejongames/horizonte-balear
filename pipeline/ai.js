// Cliente de IA con varios proveedores gratuitos y respaldo automático.
// Groq (principal) y Google Gemini (respaldo) exponen una API compatible con OpenAI,
// así que se usa el mismo código para ambos. Si un modelo agota su cuota gratuita
// se pasa al siguiente modelo y, después, al siguiente proveedor.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

function providerConfigs(env = process.env) {
  return [
    {
      name: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      key: env.GROQ_API_KEY,
      models: list(env.GROQ_MODELS || 'openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b,llama-3.3-70b-versatile'),
      discover: (id) => !/whisper|guard|tts|orpheus|compound|prompt|8b|distil|vision/i.test(id),
      minIntervalMs: 2500,
    },
    {
      name: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      key: env.GEMINI_API_KEY,
      models: list(env.GEMINI_MODELS || 'gemini-flash-latest,gemini-flash-lite-latest,gemini-2.5-flash'),
      discover: (id) => /flash/i.test(id) && !/image|tts|live|audio|embedding|thinking|exp|preview/i.test(id),
      minIntervalMs: 7000,
    },
  ].filter((p) => p.key && !/^(pon|tu|your)/i.test(p.key));
}

function parseRetryAfter(res, bodyText) {
  const h = Number(res.headers.get('retry-after'));
  if (Number.isFinite(h) && h > 0) return h * 1000;
  const m = bodyText.match(/try again in (?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?/i);
  if (m) return ((Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 1000;
  const g = bodyText.match(/retry in ([\d.]+)s/i) || bodyText.match(/"retryDelay":\s*"([\d.]+)s"/);
  if (g) return Number(g[1]) * 1000;
  return null;
}

export function extractJson(text) {
  let t = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new Error('La respuesta no contiene JSON válido');
  }
}

export class AI {
  constructor({ env = process.env, log = console.log } = {}) {
    this.log = log;
    this.providers = providerConfigs(env).map((p) => ({ ...p, lastCall: 0, disabled: false, exhausted: new Set(), cooldown: new Map() }));
    this.usage = {};
    this.ready = false;
  }

  get enabled() {
    return this.providers.length > 0;
  }

  /** Comprueba qué modelos existen realmente en cada proveedor (los nombres cambian con el tiempo). */
  async init() {
    for (const p of this.providers) {
      try {
        const res = await fetch(`${p.baseUrl}/models`, { headers: { authorization: `Bearer ${p.key}` }, signal: AbortSignal.timeout(15000) });
        if (res.status === 401 || res.status === 403) {
          p.disabled = true;
          this.log(`  ✖ ${p.name}: clave no válida (HTTP ${res.status})`);
          continue;
        }
        if (!res.ok) continue; // si no se puede listar, se usan los modelos configurados
        const data = await res.json();
        const ids = (data.data ?? []).map((m) => String(m.id).replace(/^models\//, ''));
        const available = p.models.filter((m) => ids.includes(m));
        if (available.length) p.models = available;
        else {
          const guess = ids.filter(p.discover).sort().reverse().slice(0, 3);
          this.log(`  ⚠ ${p.name}: ninguno de los modelos configurados existe; usando ${guess.join(', ') || '(ninguno)'}`);
          p.models = guess;
        }
      } catch (e) {
        this.log(`  ⚠ ${p.name}: no se pudo listar modelos (${e.message})`);
      }
    }
    this.ready = true;
    return this.providers.filter((p) => !p.disabled).map((p) => `${p.name}: ${p.models.join(', ')}`);
  }

  async #call(p, model, { system, user, maxTokens, temperature }) {
    const wait = p.lastCall + p.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    p.lastCall = Date.now();
    const body = {
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    };
    // Los modelos gpt-oss "razonan" antes de responder; con esfuerzo bajo gastan menos cuota.
    if (/gpt-oss|gemini/.test(model)) body.reasoning_effort = 'low';
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${p.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${p.name}/${model} HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      err.retryAfterMs = parseRetryAfter(res, text);
      throw err;
    }
    const data = JSON.parse(text);
    const u = data.usage ?? {};
    const key = `${p.name}/${model}`;
    this.usage[key] ??= { calls: 0, tokens: 0 };
    this.usage[key].calls++;
    this.usage[key].tokens += u.total_tokens ?? 0;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw Object.assign(new Error(`${key}: respuesta vacía`), { status: 0 });
    return extractJson(content);
  }

  /**
   * Pide una respuesta JSON probando modelos y proveedores en orden.
   * `prefer`: modelos que se prueban primero para esta tarea (si existen y les queda cuota).
   */
  async json({ system, user, maxTokens = 1500, temperature = 0.2, prefer = [] }) {
    if (!this.ready) await this.init();
    const all = this.providers.flatMap((p) => p.models.map((model) => ({ p, model })));
    const rank = (x) => {
      const i = prefer.findIndex((m) => x.model === m || x.model.endsWith(m));
      return i < 0 ? prefer.length : i;
    };
    const order = all.map((x, i) => ({ ...x, i })).sort((a, b) => rank(a) - rank(b) || a.i - b.i);
    let lastError;
    for (let round = 0; round < 3; round++) {
      for (const { p, model } of order) {
        if (p.disabled || p.exhausted.has(model) || (p.cooldown.get(model) ?? 0) > Date.now()) continue;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const data = await this.#call(p, model, { system, user, maxTokens, temperature });
            return { data, model: `${p.name}/${model}` };
          } catch (e) {
            lastError = e;
            if (e.status === 401 || e.status === 403) {
              p.disabled = true;
              this.log(`  ✖ ${p.name}: clave rechazada`);
              break;
            }
            if (e.status === 404 || (e.status === 400 && /model/i.test(e.message) && !/json/i.test(e.message))) {
              this.log(`  ⚠ ${p.name}/${model}: modelo no disponible`);
              p.exhausted.add(model);
              break;
            }
            if (e.status === 429 || e.status === 413) {
              const detail = e.message.slice(e.message.indexOf(':') + 2).replace(/\s+/g, ' ');
              const daily = /per day|per_day|daily|\bTPD\b|\bRPD\b|PerDay/i.test(detail);
              if (e.status === 413 || daily) {
                this.log(`  ⏸ ${p.name}/${model}: ${daily ? 'cuota diaria agotada' : 'petición demasiado grande'}, se usa otro modelo`);
                p.exhausted.add(model);
                break;
              }
              // Límite por minuto: esperar si es poco, o dejar descansar el modelo y probar otro.
              const ms = e.retryAfterMs ?? 30000;
              if (ms <= 12000 && attempt < 2) {
                await sleep(ms + 300);
                continue;
              }
              p.cooldown.set(model, Date.now() + Math.min(ms, 120000) + 500);
              break;
            }
            // JSON inválido, error 5xx o de red: reintentar una vez y luego cambiar de modelo
            if (attempt >= 1) break;
            await sleep(2000);
          }
        }
      }
      // Si todos los modelos con cuota están descansando, esperar al primero que quede libre.
      const waits = order
        .filter(({ p, model }) => !p.disabled && !p.exhausted.has(model))
        .map(({ p, model }) => (p.cooldown.get(model) ?? 0) - Date.now());
      if (!waits.length) break;
      const wait = Math.min(...waits);
      if (wait > 90000) break;
      if (wait > 0) await sleep(wait);
    }
    throw lastError ?? new Error('No hay ningún proveedor de IA disponible');
  }

  get exhaustedAll() {
    return this.providers.every((p) => p.disabled || p.models.every((m) => p.exhausted.has(m)));
  }
}
