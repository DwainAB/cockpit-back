import dayjs from 'dayjs';
import 'dayjs/locale/fr.js';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import isBetween from 'dayjs/plugin/isBetween.js';

dayjs.extend(relativeTime);
dayjs.extend(isoWeek);
dayjs.extend(isBetween);
dayjs.locale('fr');

export { dayjs };

/** Les données mockées sont générées relativement à aujourd'hui pour rester crédibles. */
export const today = () => dayjs().startOf('day');

/** Date ISO décalée de `days` jours par rapport à aujourd'hui, à l'heure donnée. */
export const rel = (days: number, hour = 9, minute = 0) =>
  today().add(days, 'day').hour(hour).minute(minute).toISOString();

/** Prochain lundi (ou aujourd'hui si on est lundi). */
export const nextMonday = (hour = 9) => {
  const t = today();
  const diff = (8 - t.isoWeekday()) % 7;
  return t.add(diff, 'day').hour(hour).toISOString();
};

export const fmtDate = (d: string) => dayjs(d).format('D MMM YYYY');
export const fmtShort = (d: string) => dayjs(d).format('D MMM');
export const fmtDateTime = (d: string) => dayjs(d).format('D MMM · HH:mm');
export const fmtDay = (d: string) => dayjs(d).format('dddd D MMMM');
/** Durée relative. Les horodatages mockés plus tard dans la journée s'affichent « aujourd'hui ». */
export const fromNow = (d: string) => {
  const date = dayjs(d);
  if (date.isAfter(dayjs()) && date.isSame(dayjs(), 'day')) return 'aujourd’hui';
  return date.fromNow();
};

export const isOverdue = (d: string) => dayjs(d).isBefore(today());

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

export const nowIso = () => dayjs().toISOString();

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const euro = (n: number, digits = 0) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);

/** Coût d'API, facturé en dollars. */
export const usd = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 }).format(n);
