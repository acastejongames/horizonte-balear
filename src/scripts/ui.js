// Interacciones de la web: todo es mejora progresiva (sin JS la web funciona igual).
const root = document.documentElement;
const cfg = JSON.parse(document.body.dataset.ui || '{}');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Cabecera: sombra y compacta al hacer scroll ---------- */
const topbars = document.querySelector('.topbars');
const progress = document.querySelector('.read-progress');
const backTop = document.querySelector('.back-top');
const article = document.querySelector('.article-body');
let ticking = false;
function onScroll() {
  const y = scrollY;
  topbars?.classList.toggle('is-scrolled', y > 8);
  backTop?.classList.toggle('is-visible', y > 900);
  if (progress && article) {
    const r = article.getBoundingClientRect();
    const start = r.top + y - innerHeight * 0.3;
    const end = r.bottom + y - innerHeight * 0.7;
    const done = Math.min(1, Math.max(0, (y - start) / Math.max(1, end - start)));
    progress.style.transform = `scaleX(${done})`;
  }
  ticking = false;
}
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
onScroll();
backTop?.addEventListener('click', () => scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

/* ---------- Aparición al entrar en pantalla: deslizamiento lateral escalonado ---------- */
const SLIDE = 'cubic-bezier(.22, 1, .36, 1)';
const revealables = document.querySelectorAll('[data-reveal], .section-head, .listing-head');
let io = null;
if ('IntersectionObserver' in window && !reduceMotion) {
  root.classList.add('js-reveal');
  io = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
    visible.forEach((e, i) => {
      e.target.style.transitionDelay = `${Math.min(i * 90, 450)}ms`;
      e.target.classList.add('is-visible');
      e.target.addEventListener('transitionend', () => { e.target.style.transitionDelay = ''; }, { once: true });
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  revealables.forEach((el) => io.observe(el));
}

/* ---------- Fotos: aparecen al cargar (también las que ya estaban en caché) ---------- */
document.querySelectorAll('.card-media img, .hero-img, .article-figure img').forEach((img) => {
  if (img.complete && img.naturalWidth) img.classList.add('is-loaded');
});

/* ---------- Fechas relativas ("hace 25 min") ---------- */
const fmtTime = new Intl.DateTimeFormat(cfg.locale, { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
function relTime(iso) {
  const diff = (Date.now() - Date.parse(iso)) / 60000;
  if (diff < 1) return cfg.rel.now;
  if (diff < 60) return cfg.rel.min.replace('{n}', Math.round(diff));
  if (diff < 12 * 60) return cfg.rel.h.replace('{n}', Math.round(diff / 60));
  const d = new Date(iso);
  const yesterday = new Date(Date.now() - 86400e3);
  if (d.toDateString() === yesterday.toDateString()) return `${cfg.rel.yesterday}, ${fmtTime.format(d)}`;
  return null; // se deja la fecha completa
}
function updateTimes() {
  document.querySelectorAll('time[data-rel]').forEach((el) => {
    const r = relTime(el.getAttribute('datetime'));
    if (r) {
      el.dataset.abs ??= el.textContent;
      el.textContent = r;
      el.title = el.dataset.abs;
    }
  });
}
if (cfg.rel) { updateTimes(); setInterval(updateTimes, 60000); }

/* ---------- Pestañas (por islas): indicador que se desliza y panel que entra por el lado ---------- */
document.querySelectorAll('[data-tabs]').forEach((box) => {
  const list = box.querySelector('[role=tablist]');
  const tabs = [...box.querySelectorAll('[role=tab]')];
  const indicator = box.querySelector('.tab-indicator');
  let current = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
  const moveIndicator = (tab, instant = false) => {
    if (!indicator) return;
    if (instant) indicator.style.transition = 'none';
    indicator.style.width = `${tab.offsetWidth}px`;
    indicator.style.translate = `${tab.offsetLeft}px 0`;
    if (instant) { void indicator.offsetWidth; indicator.style.transition = ''; }
  };
  if (indicator) {
    list.classList.add('has-indicator');
    moveIndicator(tabs[current], true);
    addEventListener('resize', () => moveIndicator(tabs[current], true));
    document.fonts?.ready.then(() => moveIndicator(tabs[current], true));
  }
  const panelOf = (t) => document.getElementById(t.getAttribute('aria-controls'));
  const select = (index, focus = false) => {
    if (index === current) return;
    const dir = index > current ? 1 : -1;
    const oldTab = tabs[current];
    const newTab = tabs[index];
    const oldPanel = panelOf(oldTab);
    const newPanel = panelOf(newTab);
    current = index;
    tabs.forEach((t, i) => { t.setAttribute('aria-selected', String(i === index)); t.tabIndex = i === index ? 0 : -1; });
    moveIndicator(newTab);
    if (focus) newTab.focus();
    const show = () => {
      oldPanel.hidden = true;
      newPanel.hidden = false;
      newPanel.querySelectorAll('[data-reveal]').forEach((c) => { c.classList.add('is-visible'); io?.unobserve(c); });
      if (reduceMotion) return;
      [...newPanel.querySelectorAll('.card, .panel-link')].forEach((el, i) => {
        el.animate([{ opacity: 0, translate: `${dir * 70}px 0` }, { opacity: 1, translate: '0 0' }], { duration: 750, delay: i * 70, easing: SLIDE, fill: 'backwards' });
      });
    };
    if (reduceMotion) return show();
    const out = oldPanel.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: `${-dir * 50}px 0` }], { duration: 220, easing: 'cubic-bezier(.55, 0, .75, .2)' });
    // Respaldo: si la animación no llega a terminar (pestaña en segundo plano), cambia igualmente.
    let done = false;
    const finish = () => { if (!done) { done = true; show(); } };
    out.onfinish = finish;
    setTimeout(finish, 280);
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(i));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); select((i + d + tabs.length) % tabs.length, true); }
    });
  });
});

/* ---------- "Ver más noticias": las nuevas tarjetas entran deslizándose ---------- */
document.querySelectorAll('[data-loadmore]').forEach((section) => {
  const step = Number(section.dataset.loadmore) || 9;
  const btn = section.querySelector('[data-loadmore-btn]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const hidden = [...section.querySelectorAll('.card[hidden]')];
    hidden.slice(0, step).forEach((c, i) => {
      io?.unobserve(c);
      c.hidden = false;
      c.classList.add('is-visible');
      if (!reduceMotion) c.animate([{ opacity: 0, translate: '80px 0' }, { opacity: 1, translate: '0 0' }], { duration: 850, delay: i * 70, easing: SLIDE, fill: 'backwards' });
    });
    const left = hidden.length - step;
    if (left <= 0) btn.parentElement.remove();
    else btn.textContent = btn.dataset.label.replace('999', left);
  });
});

/* ---------- Compartir / copiar enlace ---------- */
const toast = document.querySelector('.toast');
function showToast(text) {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('is-visible');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => toast.classList.remove('is-visible'), 2200);
}
document.querySelectorAll('[data-share]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const data = { title: document.title, url: location.href };
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share(data);
      else { await navigator.clipboard.writeText(location.href); showToast(cfg.copied); }
    } catch { /* cancelado por el usuario */ }
  });
});

/* ---------- Menú móvil (panel lateral) ---------- */
const menuBtn = document.querySelector('[data-menu-btn]');
const setMenu = (open) => {
  document.body.classList.toggle('menu-open', open);
  menuBtn?.setAttribute('aria-expanded', String(open));
};
menuBtn?.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
// Clic en el fondo oscurecido o en un enlace: cerrar.
document.querySelector('.site-header')?.addEventListener('click', (e) => {
  if (!document.body.classList.contains('menu-open')) return;
  if (e.target.classList.contains('site-header') || e.target.closest('.nav a')) setMenu(false);
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

/* ---------- Atajos: Ctrl/⌘+K o "/" para buscar ---------- */
const searchLink = document.querySelector('[data-search-link]');
const kbd = document.querySelector('[data-kbd]');
if (/Mac|iPhone|iPad/.test(navigator.platform) && kbd) kbd.textContent = '⌘K';
addEventListener('keydown', (e) => {
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName ?? '');
  if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
    const input = document.getElementById('q');
    e.preventDefault();
    if (input) input.focus();
    else if (searchLink) location.href = searchLink.href;
  }
});
