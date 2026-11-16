// Medios de los que se extraen noticias.
//
// - group: grupo empresarial. Dos medios del mismo grupo NO cuentan como
//   fuentes independientes al contrastar (p. ej. Última Hora y Menorca.info).
// - type: 'rss' (RSS/Atom) o 'news-sitemap' (sitemap de Google News, sin resumen).
// - localOnly: si es false, el feed mezcla noticias nacionales/internacionales y
//   solo se aceptan las que tengan una URL de sección local o mencionen Baleares.
// - lang: idioma principal del medio ('es' o 'ca').
// - allowImages: pon false si el medio pide que no se usen sus fotos (se dejan de mostrar al instante).

export const SOURCES = [
  {
    id: 'ultimahora',
    name: 'Última Hora',
    homepage: 'https://www.ultimahora.es',
    group: 'Grupo Serra',
    lang: 'es',
    localOnly: true,
    feeds: [{ type: 'rss', url: 'https://www.ultimahora.es/feed.rss' }],
  },
  {
    id: 'diariodemallorca',
    name: 'Diario de Mallorca',
    homepage: 'https://www.diariodemallorca.es',
    group: 'Prensa Ibérica',
    lang: 'es',
    localOnly: false,
    localPaths: ['/mallorca/', '/palma/', '/part-forana/', '/sucesos/', '/tribunales/', '/baleares/', '/deportes/real-mallorca/', '/cultura/', '/sociedad/', '/economia/'],
    feeds: [
      { type: 'rss', url: 'https://www.diariodemallorca.es/rss/section/2516' }, // Mallorca
      { type: 'rss', url: 'https://www.diariodemallorca.es/rss/section/2543' }, // Part Forana
      { type: 'rss', url: 'https://www.diariodemallorca.es/rss/section/1616495' }, // Sucesos Mallorca
      { type: 'rss', url: 'https://www.diariodemallorca.es/rss/' }, // General (mixto)
    ],
  },
  {
    id: 'cronicabalear',
    name: 'Crónica Balear',
    homepage: 'https://www.cronicabalear.es',
    group: 'Crónica Balear',
    lang: 'es',
    localOnly: true,
    feeds: [{ type: 'news-sitemap', url: 'https://www.cronicabalear.es/sitemap-news.xml' }],
  },
  {
    id: 'diariodeibiza',
    name: 'Diario de Ibiza',
    homepage: 'https://www.diariodeibiza.es',
    group: 'Prensa Ibérica',
    lang: 'es',
    localOnly: false,
    localPaths: ['/ibiza/', '/formentera/', '/pitiusas/', '/baleares/', '/sucesos/', '/tribunales/'],
    feeds: [
      { type: 'rss', url: 'https://www.diariodeibiza.es/rss/section/16001' }, // Ibiza
      { type: 'rss', url: 'https://www.diariodeibiza.es/rss/section/16023' }, // Formentera
      { type: 'rss', url: 'https://www.diariodeibiza.es/rss/section/1687470' }, // Pitiusas y Baleares
      { type: 'rss', url: 'https://www.diariodeibiza.es/rss/section/16012' }, // Sucesos
    ],
  },
  {
    id: 'periodicodeibiza',
    name: 'Periódico de Ibiza y Formentera',
    homepage: 'https://www.periodicodeibiza.es',
    group: 'Grupo Serra',
    lang: 'es',
    localOnly: true,
    feeds: [{ type: 'rss', url: 'https://www.periodicodeibiza.es/feed.rss' }],
  },
  {
    id: 'menorcainfo',
    name: 'Menorca · Es Diari',
    homepage: 'https://www.menorca.info',
    group: 'Grupo Serra',
    lang: 'es',
    localOnly: true,
    feeds: [{ type: 'rss', url: 'https://www.menorca.info/feed.rss' }],
  },
  {
    id: 'arabalears',
    name: 'Ara Balears',
    homepage: 'https://www.arabalears.cat',
    group: 'Grup Ara',
    lang: 'ca',
    localOnly: true,
    feeds: [{ type: 'rss', url: 'https://www.arabalears.cat/rss/' }],
  },
  {
    id: 'dbalears',
    name: 'dBalears',
    homepage: 'https://www.dbalears.cat',
    group: 'Grupo Serra',
    lang: 'ca',
    localOnly: true,
    feeds: [{ type: 'rss', url: 'https://www.dbalears.cat/feed.rss' }],
  },
  {
    id: 'ib3',
    name: 'IB3 Notícies',
    homepage: 'https://ib3.org',
    group: 'IB3 (pública)',
    lang: 'ca',
    localOnly: true,
    feeds: [{ type: 'rss', url: 'https://ib3.org/rss' }],
  },
  {
    id: 'europapress',
    name: 'Europa Press Baleares',
    homepage: 'https://www.europapress.es/illes-balears/',
    group: 'Europa Press',
    lang: 'es',
    localOnly: true,
    feeds: [{ type: 'rss', url: 'https://www.europapress.es/rss/rss.aspx?ch=288' }],
  },
  {
    id: 'elmundobaleares',
    name: 'El Mundo Baleares',
    homepage: 'https://www.elmundo.es/baleares.html',
    group: 'Unidad Editorial',
    lang: 'es',
    localOnly: true,
    feeds: [{ type: 'rss', url: 'https://www.elmundo.es/rss/googlenews/baleares.xml' }],
  },
  {
    id: 'mallorcadiario',
    name: 'mallorcadiario.com',
    homepage: 'https://www.mallorcadiario.com',
    group: 'mallorcadiario',
    lang: 'es',
    localOnly: true,
    feeds: [{ type: 'rss', url: 'https://www.mallorcadiario.com/feed' }],
  },
  {
    id: 'noudiari',
    name: 'Noudiari',
    homepage: 'https://www.noudiari.es',
    group: 'Noudiari',
    lang: 'es',
    localOnly: true,
    feeds: [{ type: 'rss', url: 'https://www.noudiari.es/feed/' }],
  },
];

export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s]));

// Palabras que indican que una noticia de un feed mixto trata de Baleares.
export const BALEARIC_KEYWORDS = [
  'balear', 'baleares', 'balears', 'mallorca', 'menorca', 'ibiza', 'eivissa', 'formentera',
  'palma', 'pitiusas', 'pitiüses', 'govern', 'parlament', 'consell de', 'consell insular',
  'calvià', 'calvia', 'manacor', 'inca', 'llucmajor', 'marratxí', 'marratxi', 'alcúdia', 'alcudia',
  'sóller', 'soller', 'pollença', 'pollensa', 'felanitx', 'santanyí', 'santanyi', 'andratx',
  'maó', 'mahon', 'mahón', 'ciutadella', 'sant antoni', 'santa eulària', 'santa eularia',
  'son sant joan', 'son espases', 'prohens', 'uib',
];

export const ISLANDS = ['mallorca', 'menorca', 'ibiza', 'formentera', 'baleares'];

export const TOPICS = [
  'politica', 'sucesos', 'tribunales', 'economia', 'turismo', 'vivienda', 'sanidad',
  'educacion', 'medioambiente', 'movilidad', 'sociedad', 'cultura', 'deportes',
];
