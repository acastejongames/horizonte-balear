const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Enlace interno respetando la ruta base (necesaria en GitHub Pages). */
export const href = (path = '/') => `${BASE}${path.startsWith('/') ? path : '/' + path}`;

export const storyUrl = (lang, story) => href(`/${lang}/noticia/${story.slug}/`);
