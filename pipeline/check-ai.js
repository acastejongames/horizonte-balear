// Comprueba que las claves de IA funcionan:  npm run check-ai
import { AI } from './ai.js';

const ai = new AI();
if (!ai.enabled) {
  console.log('✖ No hay claves. Copia .env.example a .env y pon GROQ_API_KEY (y opcionalmente GEMINI_API_KEY).');
  process.exit(1);
}
console.log('Modelos disponibles:', await ai.init());
for (const p of ai.providers) {
  if (p.disabled) { console.log(`✖ ${p.name}: clave no válida`); continue; }
  const solo = new AI();
  solo.providers = solo.providers.filter((x) => x.name === p.name);
  try {
    const { data, model } = await solo.json({
      system: 'Responde solo con JSON.',
      user: 'Devuelve {"ok":true,"isla":"Mallorca","illa_en_catala":"Mallorca"}',
      maxTokens: 200,
    });
    console.log(`✔ ${p.name} funciona (${model}):`, JSON.stringify(data));
  } catch (e) {
    console.log(`✖ ${p.name}: ${e.message.slice(0, 300)}`);
  }
}
