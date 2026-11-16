# Horizonte Balear

Web de noticias de las Islas Baleares que:

1. **Recoge** cada 30 minutos las noticias de los principales medios de Baleares (RSS).
2. **Agrupa** con IA los artículos de distintos medios que cuentan el mismo hecho, en castellano o en catalán.
3. **Contrasta** los datos entre medios de grupos empresariales distintos y marca cada noticia como
   ✓ *Contrastada*, ◔ *Fuente única* o ⚠ *Datos contradictorios*.
4. **Redacta** un resumen propio en castellano y catalán, sin copiar a los medios y enlazando siempre a las fuentes originales.
5. **Publica** una web estática (portada, islas, temas, buscador, RSS, metodología).

Todo funciona con servicios gratuitos: **Groq** (IA principal), **Google Gemini** (IA de respaldo), **GitHub Actions** (ejecución automática) y **GitHub Pages** (alojamiento).

## Estructura

```
pipeline/            Motor de noticias (Node.js)
  sources.js         Lista de medios, grupos y feeds  ← para añadir o quitar medios
  fetch.js           Descarga y lectura de RSS / sitemaps
  cluster.js         Agrupación de artículos por hecho (IA + respaldo léxico)
  writer.js          Contraste y redacción bilingüe (IA)
  ai.js              Cliente Groq → Gemini con cambio automático de modelo si se agota la cuota
  run.js             Ejecución completa
  check-ai.js        Comprueba que las claves funcionan
data/                Noticias generadas (las guarda el propio robot)
src/                 Web (Astro)
.github/workflows/   Automatización cada 30 minutos
```

## Uso en tu ordenador

Requisitos: Node.js 22.23 o superior.

```bash
npm install
```

Pon tus claves en el archivo `.env` (cópialo de `.env.example` si no existe):

- `GROQ_API_KEY`: en https://console.groq.com/keys
- `GEMINI_API_KEY` (respaldo, opcional): en https://aistudio.google.com/apikey

```bash
npm run check-ai     # comprueba las claves
npm run update       # busca, contrasta y redacta noticias
npm run dev          # abre la web en http://localhost:4321
```

## Publicarla en Internet (gratis, con GitHub)

1. Crea un repositorio **público** en GitHub (p. ej. `horizonte-balear`). GitHub Pages es gratis en los repositorios públicos.
2. Sube este proyecto:
   ```bash
   git remote add origin https://github.com/TU_USUARIO/horizonte-balear.git
   git push -u origin main
   ```
3. En el repositorio: **Settings → Secrets and variables → Actions → New repository secret**:
   - `GROQ_API_KEY` = tu clave de Groq
   - `GEMINI_API_KEY` = tu clave de Gemini
4. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. **Actions → "Actualizar noticias y publicar" → Run workflow** para la primera ejecución.

A partir de ahí se actualiza sola cada 30 minutos. La web queda en `https://TU_USUARIO.github.io/horizonte-balear/`.
Para usar un dominio propio: **Settings → Pages → Custom domain**.

## Antes de publicar

- Rellena tus datos en `src/site.config.js` (nombre, NIF, domicilio y correo). La ley (LSSI) obliga a mostrarlos en el aviso legal.
- **Fotos:** se muestra la foto que publica cada medio, con su nombre y un enlace a la noticia original. Si un medio te pide que no uses sus fotos, pon `allowImages: false` en ese medio dentro de `pipeline/sources.js` y desaparecerán en la siguiente publicación.

## Ajustes

En `.env` (local) o como variables del workflow:

| Variable | Por defecto | Qué hace |
|---|---|---|
| `MAX_WRITES_PER_RUN` | 25 | Noticias redactadas como máximo por ejecución |
| `SINGLE_SOURCE_DELAY_MIN` | 60 | Minutos de espera para que otro medio confirme antes de publicar con fuente única |
| `RETENTION_DAYS` | 30 | Días en `data/stories.json`; las más antiguas pasan a `data/archive/` (siguen publicadas) |
| `GROQ_MODELS` / `GEMINI_MODELS` | ver `ai.js` | Orden de modelos a usar |

## Límites y avisos

- Los planes gratuitos de Groq y Gemini tienen cuotas diarias. Si se agotan, las noticias pendientes se redactan en la siguiente ejecución.
- GitHub desactiva las tareas programadas de un repositorio tras 60 días sin actividad. Los commits del robot cuentan como actividad, pero si se para, basta con pulsar *Run workflow*.
- La web publica resúmenes propios con enlace a los originales y no reproduce los artículos.
- Las fotos pertenecen a los medios. Se cargan desde sus servidores y se muestran con crédito y enlace, pero usarlas sin permiso tiene riesgo legal: atiende enseguida cualquier petición de retirada.
- El tiempo de la barra superior viene de Open-Meteo (gratis, sin clave) y se actualiza en directo.
