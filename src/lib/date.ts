/**
 * Date helpers. All calendar dates are local 'YYYY-MM-DD' strings (ISODate) and all
 * day arithmetic goes through UTC, so daylight-saving changes can never shift a day.
 *
 * ISODate strings sort lexicographically: use plain `a < b` / `a === b` to compare.
 */
import type { ISODate, TimeOfDay } from '../types';

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

function toUTC(iso: ISODate): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): ISODate {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// ───────────────────────── Conversion ─────────────────────────

/** Local calendar date of a Date object. */
export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's local date. */
export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

/** Local midnight of the given date. */
export function parseISODate(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** True for a real calendar date in 'YYYY-MM-DD' form ('2026-02-30' is rejected). */
export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fromUTC(toUTC(s)) === s;
}

/** Local Date for a date + time, e.g. ('2026-11-16', '15:30'). */
export function toDateTime(iso: ISODate, time: TimeOfDay): Date {
  const [y, m, d] = iso.split('-').map(Number);
  const mins = parseTime(time);
  return new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60, 0, 0);
}

// ───────────────────────── Arithmetic ─────────────────────────

export function addDays(iso: ISODate, n: number): ISODate {
  return fromUTC(toUTC(iso) + n * DAY_MS);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(iso: ISODate): number {
  return (new Date(toUTC(iso)).getUTCDay() + 6) % 7;
}

export function isWeekend(iso: ISODate): boolean {
  return weekdayIndex(iso) >= 5;
}

/** The Monday of the week containing `iso`. */
export function startOfWeek(iso: ISODate): ISODate {
  return addDays(iso, -weekdayIndex(iso));
}

/** The 7 dates (Monday → Sunday) of the week containing `iso`. */
export function weekDates(iso: ISODate): ISODate[] {
  const monday = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function startOfMonth(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

/** First day of the month `n` months away from the month containing `iso`. */
export function addMonths(iso: ISODate, n: number): ISODate {
  const [y, m] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
}

/**
 * Calendar grid for the month containing `iso`: full weeks (Monday first),
 * including the spill-over days of the previous and next month.
 */
export function monthGrid(iso: ISODate): ISODate[][] {
  const first = startOfMonth(iso);
  const nextFirst = addMonths(first, 1);
  const weeks: ISODate[][] = [];
  let cursor = startOfWeek(first);
  while (cursor < nextFirst) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function isSameMonth(a: ISODate, b: ISODate): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** All dates from `from` up to and including `to`. Empty when `to < from`. */
export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const n = diffDays(from, to);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

// ───────────────────────── Time of day ─────────────────────────

/** 'HH:mm' → minutes since midnight. */
export function parseTime(time: TimeOfDay): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes since midnight → 'HH:mm' (clamped to 00:00–23:59). */
export function formatTime(minutes: number): TimeOfDay {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function isValidTime(s: unknown): s is TimeOfDay {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Minutes since local midnight for a Date. */
export function minutesOfDay(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

// ───────────────────────── Dutch formatting ─────────────────────────

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('nl-NL', { ...opts, timeZone: 'UTC' });

const F_LONG = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const F_LONG_YEAR = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const F_SHORT = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const F_DAY_MONTH = fmt({ day: 'numeric', month: 'long' });
const F_MONTH_YEAR = fmt({ month: 'long', year: 'numeric' });
const F_MONTH_SHORT = fmt({ month: 'short' });
const F_WEEKDAY = fmt({ weekday: 'long' });

const clean = (s: string) => s.replace(/\./g, '');

/** "maandag 16 november" (adds the year when it differs from `today`'s year). */
export function formatDateLong(iso: ISODate, today: ISODate = todayISO()): string {
  const f = iso.slice(0, 4) === today.slice(0, 4) ? F_LONG : F_LONG_YEAR;
  return f.format(toUTC(iso));
}

/** "ma 16 nov" */
export function formatDateShort(iso: ISODate): string {
  return clean(F_SHORT.format(toUTC(iso)));
}

/** "16 november" */
export function formatDayMonth(iso: ISODate): string {
  return F_DAY_MONTH.format(toUTC(iso));
}

/** "november 2026" */
export function formatMonthYear(iso: ISODate): string {
  return F_MONTH_YEAR.format(toUTC(iso));
}

/** "nov" */
export function formatMonthShort(iso: ISODate): string {
  return clean(F_MONTH_SHORT.format(toUTC(iso)));
}

/** "maandag" */
export function formatWeekday(iso: ISODate): string {
  return F_WEEKDAY.format(toUTC(iso));
}

/** Day of the month without leading zero: 16 */
export function dayOfMonth(iso: ISODate): number {
  return Number(iso.slice(8, 10));
}

/** "vandaag", "morgen", "overmorgen", "gisteren", "over 5 dagen", "3 dagen geleden". */
export function formatRelative(iso: ISODate, today: ISODate = todayISO()): string {
  const d = diffDays(today, iso);
  if (d === 0) return 'vandaag';
  if (d === 1) return 'morgen';
  if (d === 2) return 'overmorgen';
  if (d === -1) return 'gisteren';
  if (d === -2) return 'eergisteren';
  return d > 0 ? `over ${d} dagen` : `${-d} dagen geleden`;
}

/** 45 → "45 min", 60 → "1 uur", 90 → "1 u 30 min", 120 → "2 uur". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} uur` : `${h} u ${rest} min`;
}

/** ISO-8601 week number. */
export function weekNumber(iso: ISODate): number {
  const thursday = toUTC(addDays(startOfWeek(iso), 3));
  const jan1 = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
  return Math.floor((thursday - jan1) / DAY_MS / 7) + 1;
}
