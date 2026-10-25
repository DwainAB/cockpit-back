/**
 * Générateur de design simulé : aucune IA n'est appelée.
 * Sert au mode démo et au backend quand aucune clé API n'est configurée.
 */
import { dayKeys, dayLabels, formatAddress, formatDayHours } from './labels';
import type { BuildCheck, DesignResult, QuestionnaireAnswers } from './types';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const presets = [
  { name: 'Ardoise chaleureuse', palette: ['#2F5D50', '#F4EDE1', '#C9773A'], heading: 'Playfair Display', body: 'Lora' },
  { name: 'Néon de quartier', palette: ['#1E1B2E', '#F7F3EA', '#E4572E'], heading: 'Bebas Neue', body: 'Inter' },
  { name: 'Terrasse ensoleillée', palette: ['#8C3B2E', '#FFF8EE', '#E9B44C'], heading: 'DM Serif Display', body: 'Poppins' },
  { name: 'Épure minérale', palette: ['#22303C', '#EEF1F3', '#5E9C7D'], heading: 'Cormorant Garamond', body: 'Montserrat' },
];

const sampleDishes = ['Entrée de saison', 'Plat signature', 'Spécialité de la maison', 'Dessert du moment'];

export const simulateDesign = (a: QuestionnaireAnswers, versionNumber: number, feedback: string | null): DesignResult => {
  const preset = presets[(versionNumber - 1) % presets.length];
  const [primary, background, accent] = [a.branding.colors[0] ?? preset.palette[0], a.branding.colors[1] ?? preset.palette[1], a.branding.colors[2] ?? preset.palette[2]];
  const heading = a.branding.font ?? preset.heading;
  const body = preset.body;
  const fonts = [...new Set([heading, body])].map((f) => `family=${f.replace(/ /g, '+')}`).join('&');
  const hero = a.images[0];
  const gallery = a.images.slice(1, 4);

  const hours = dayKeys
    .map((d) => `<li><span>${dayLabels[d]}</span><span>${formatDayHours(a.hours[d])}</span></li>`)
    .join('');
  const ctas = [
    a.onlineOrdering ? '<a class="btn" href="#commander">Commander</a>' : '',
    a.takesReservations ? '<a class="btn btn-outline" href="#reserver">Réserver</a>' : '',
  ].join('');

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(a.name)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">
<style>
:root{--primary:${primary};--bg:${background};--accent:${accent}}
*{box-sizing:border-box}body{margin:0;font-family:'${body}',system-ui,sans-serif;background:var(--bg);color:#1d1d1f;line-height:1.6}
h1,h2{font-family:'${heading}',serif;line-height:1.1;margin:0 0 .5em}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
header.hero{min-height:78vh;display:flex;align-items:flex-end;padding:48px 0;color:#fff;background:${hero ? `linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.65)),url('${esc(hero.file.url)}') center/cover` : `radial-gradient(circle at 20% 20%,var(--accent),transparent 45%),var(--primary)`}}
.logo{height:64px;margin-bottom:16px}.hero h1{font-size:clamp(2.6rem,7vw,5rem)}.hero p{font-size:1.2rem;opacity:.9;max-width:560px}
.btn{display:inline-block;margin:16px 12px 0 0;padding:14px 26px;border-radius:999px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
.btn-outline{background:transparent;border:2px solid #fff}
section{padding:72px 0}.about{display:grid;gap:32px;grid-template-columns:1fr}
.menu ul,.hours ul{list-style:none;padding:0;margin:0}.menu li{display:flex;justify-content:space-between;border-bottom:1px dashed rgba(0,0,0,.2);padding:14px 0}
.hours li{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.08)}
.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.gallery img{width:100%;height:220px;object-fit:cover;border-radius:12px}
.contact{background:var(--primary);color:#fff}.contact a{color:#fff}
footer{padding:24px 0;text-align:center;font-size:.9rem;opacity:.7}
.tag{display:inline-block;font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:8px}
@media(min-width:800px){.about{grid-template-columns:1.2fr 1fr}}
</style></head>
<body>
<header class="hero" data-section="hero"><div class="wrap">
${a.logo ? `<img class="logo" src="${esc(a.logo.url)}" alt="Logo ${esc(a.name)}">` : ''}
<span class="tag">${esc(a.restaurantType)}</span><h1>${esc(a.name)}</h1>
<p>Une cuisine ${esc(a.restaurantType.toLowerCase())} préparée avec soin, au cœur du quartier.</p>${ctas}
</div></header>
<section data-section="about"><div class="wrap about"><div><span class="tag">Notre maison</span><h2>Bienvenue chez ${esc(a.name)}</h2>
<p>Texte de présentation d’exemple : l’agent le rédigera à partir de vos informations.</p></div>
${gallery.length ? `<div class="gallery">${gallery.map((g) => `<img src="${esc(g.file.url)}" alt="${esc(g.description)}">`).join('')}</div>` : ''}</div></section>
<section class="menu" data-section="menu-preview"><div class="wrap"><span class="tag">À la carte</span><h2>Un aperçu du menu</h2>
<ul>${sampleDishes.map((d) => `<li><span>${d}</span><span>— €</span></li>`).join('')}</ul>
${a.onlineOrdering ? '<a class="btn" href="#commander">Voir la carte et commander</a>' : ''}</div></section>
<section class="hours" data-section="hours"><div class="wrap"><span class="tag">Horaires</span><h2>Quand venir</h2><ul>${hours}</ul></div></section>
<section class="contact" data-section="contact"><div class="wrap"><h2>Nous trouver</h2>
<p>${esc(formatAddress(a.address))}<br><a href="tel:${esc(a.phone)}">${esc(a.phone)}</a> · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a></p>${ctas}</div></section>
<footer data-section="footer">© ${esc(a.name)}</footer>
</body></html>`;

  return {
    concept: {
      name: `${preset.name} (simulé)`,
      summary: feedback ? `Variante simulée tenant compte de : « ${feedback} ».` : 'Proposition simulée à partir du questionnaire, sans appel à une IA.',
      palette: [primary, background, accent],
      fonts: { heading, body },
    },
    notes: [
      'Aperçu simulé : configurez la clé API Claude pour obtenir un design réellement unique.',
      'Les plats de l’aperçu du menu sont des exemples (le menu n’est pas demandé dans le questionnaire).',
      ...(a.customRequests ? [`Demandes particulières non traitées par la simulation : « ${a.customRequests} »`] : []),
    ],
    seo: {
      title: `${a.name} — ${a.restaurantType}`,
      description: `${a.name}, restaurant ${a.restaurantType.toLowerCase()} : horaires, adresse et contact.`,
      keywords: [a.name, a.restaurantType, 'restaurant'],
      ogDescription: `Découvrez ${a.name}.`,
      jsonLd: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Restaurant', name: a.name, servesCuisine: a.restaurantType, address: formatAddress(a.address), telephone: a.phone, email: a.email }),
    },
    sections: [
      { id: 'hero', purpose: 'Nom, type de cuisine, boutons Commander / Réserver' },
      { id: 'about', purpose: 'Présentation et photos' },
      { id: 'menu-preview', purpose: 'Aperçu du menu' },
      { id: 'hours', purpose: 'Horaires' },
      { id: 'contact', purpose: 'Adresse et contact' },
      { id: 'footer', purpose: 'Pied de page' },
    ],
    html,
  };
};

/** Résultats de tests simulés (mode démo ou sans clé API). */
export const simulatedBuildChecks = (a: QuestionnaireAnswers): BuildCheck[] => [
  { name: 'Compilation Next.js', passed: true, detail: 'Simulation : aucun build réel.' },
  { name: 'Bouton Commander → plateforme', passed: true, detail: a.onlineOrdering ? undefined : 'Absent (pas de commande en ligne)' },
  { name: 'Bouton Réserver → plateforme', passed: true, detail: a.takesReservations ? undefined : 'Absent (pas de réservation)' },
  { name: 'Horaires', passed: true },
  { name: 'Coordonnées', passed: true },
  { name: 'Référencement', passed: true },
];
