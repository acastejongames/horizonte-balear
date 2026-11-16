import { defineConfig } from 'astro/config';

// SITE_URL y BASE_PATH los rellena GitHub Actions al publicar en GitHub Pages
// (p. ej. https://usuario.github.io y /horizonte-balear). En local no hacen falta.
export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
});
