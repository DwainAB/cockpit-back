/**
 * Tests automatiques d'un site développé, sur le HTML produit par l'export statique Next.js.
 * Ils vérifient ce que le formulaire et la maquette imposent : liens vers la plateforme,
 * horaires, coordonnées, référencement, accessibilité de base et sections de la maquette.
 */
import { daySlots, dayKeys, dayLabels, type BuildCheck, type SiteDraft } from './core';

const stripTags = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
const digits = (s: string) => s.replace(/\D/g, '');
/** Comparaison souple : sans accents, majuscules ni ponctuation (« Jean-Jaurès » = « jean jaures »). */
const loose = (s: string) => ` ${s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** Heure « 12:00 » acceptée sous les formes 12:00, 12h00, 12 h 00, 12h. */
const timePatterns = (t: string) => {
  const [h, m] = t.split(':');
  const hh = String(Number(h));
  return m === '00' ? [`${h}:${m}`, `${hh}:${m}`, `${hh}h`, `${hh} h`, `${h}h`] : [`${h}:${m}`, `${hh}:${m}`, `${hh}h${m}`, `${hh} h ${m}`];
};

export const runChecks = (html: string, draft: SiteDraft, basePath: string, sectionIds: string[]): BuildCheck[] => {
  const a = draft.answers;
  const text = decode(stripTags(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')));
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({
    href: decode(/href="([^"]*)"/i.exec(m[1])?.[1] ?? ''),
    label: decode(stripTags(m[2])).toLowerCase(),
  }));
  const checks: BuildCheck[] = [];
  const add = (name: string, passed: boolean, detail?: string) => checks.push({ name, passed, detail });

  // Boutons vers la plateforme Yumco.
  const ctaCheck = (name: string, keyword: RegExp, expected: boolean) => {
    const found = anchors.filter((x) => keyword.test(x.label));
    if (!expected) return add(name, found.length === 0, found.length ? `Bouton présent alors que le service n’est pas proposé (${found.length})` : 'Absent, comme attendu');
    if (!found.length) return add(name, false, 'Aucun bouton trouvé');
    const wrong = found.filter((x) => x.href !== draft.platformUrl);
    add(name, wrong.length === 0, wrong.length ? `Lien incorrect : ${wrong.map((x) => x.href || '(vide)').join(', ')} (attendu ${draft.platformUrl})` : `${found.length} bouton(s) → ${draft.platformUrl}`);
  };
  ctaCheck('Bouton Commander → plateforme', /command/, a.onlineOrdering);
  ctaCheck('Bouton Réserver → plateforme', /r[ée]serv/, a.takesReservations);

  // Horaires : chaque jour et chaque heure du formulaire.
  const missing: string[] = [];
  for (const d of dayKeys) {
    if (!text.toLowerCase().includes(dayLabels[d].toLowerCase())) missing.push(dayLabels[d]);
    for (const slot of daySlots(a.hours[d]))
      for (const t of [slot.open, slot.close]) if (!timePatterns(t).some((p) => text.includes(p))) missing.push(`${dayLabels[d]} ${t}`);
  }
  add('Horaires', missing.length === 0, missing.length ? `Manquant : ${[...new Set(missing)].slice(0, 6).join(', ')}` : undefined);

  // Coordonnées.
  const contactMissing = [
    !digits(text).includes(digits(a.phone)) && 'téléphone',
    !text.toLowerCase().includes(a.email.toLowerCase()) && 'e-mail',
    !loose(text).includes(loose(a.address.street)) && 'adresse',
  ].filter(Boolean);
  add('Coordonnées', contactMissing.length === 0, contactMissing.length ? `Manquant : ${contactMissing.join(', ')}` : undefined);

  // Référencement.
  const seoMissing = [
    !/<html[^>]*\blang="fr/i.test(html) && 'langue fr',
    !/<title>[^<]{5,}<\/title>/i.test(html) && 'titre',
    !/<meta[^>]+name="description"[^>]+content="[^"]{20,}"/i.test(html) && 'meta description',
    !/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?Restaurant[\s\S]*?<\/script>/i.test(html) && 'JSON-LD Restaurant',
    !/<meta[^>]+name="viewport"/i.test(html) && 'viewport mobile',
  ].filter(Boolean);
  const h1 = (html.match(/<h1\b/gi) ?? []).length;
  if (h1 !== 1) seoMissing.push(`${h1} titre(s) h1 au lieu d’un seul`);
  add('Référencement', seoMissing.length === 0, seoMissing.length ? `À corriger : ${seoMissing.join(', ')}` : undefined);

  // Structure accessible.
  const a11y = [
    !/<main\b/i.test(html) && 'balise <main>',
    !/<footer\b/i.test(html) && 'balise <footer>',
    !/href="tel:/i.test(html) && 'lien tel:',
    !/href="mailto:/i.test(html) && 'lien mailto:',
  ].filter(Boolean);
  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  if (levels.some((l, i) => i > 0 && l > levels[i - 1] + 1)) a11y.push('hiérarchie des titres qui saute un niveau');
  const emptyLinks = anchors.filter((x) => !x.label.trim()).length;
  if (emptyLinks) a11y.push(`${emptyLinks} lien(s) sans texte`);
  add('Structure accessible', a11y.length === 0, a11y.length ? `À corriger : ${a11y.join(', ')}` : undefined);

  // Accessibilité des images.
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((i) => !/\balt="[^"]+"/i.test(i));
  // Nom du fichier de chaque image fautive, pour que l'agent sache laquelle corriger.
  const noAltFiles = noAlt.map((i) => /\bsrc="([^"]+)"/i.exec(i)?.[1].split('/').pop() ?? 'image sans src');
  add(
    'Textes alternatifs des images',
    noAlt.length === 0,
    noAlt.length ? `${noAlt.length} image(s) sans texte alternatif (alt vide ou absent) : ${noAltFiles.join(', ')}` : `${imgs.length} image(s)`,
  );

  // Sections de la maquette.
  const sectionsMissing = sectionIds.filter((id) => !html.includes(`data-section="${id}"`));
  add('Sections de la maquette', sectionsMissing.length === 0, sectionsMissing.length ? `Manquantes : ${sectionsMissing.join(', ')}` : `${sectionIds.length} section(s)`);

  // Aucun script externe.
  const external = [...html.matchAll(/<script[^>]+src="([^"]+)"/gi)].map((m) => m[1]).filter((src) => !src.startsWith(`${basePath}/_next/`));
  add('Aucun script externe', external.length === 0, external.length ? external.join(', ') : undefined);

  return checks;
};
