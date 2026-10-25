/** Date formatting helpers in the household language. */

import { DAY } from '$lib/shared/stats';
import { language, locale, m } from './i18n';

interface Formats {
	date: Intl.DateTimeFormat;
	dateYear: Intl.DateTimeFormat;
	time: Intl.DateTimeFormat;
	day: Intl.DateTimeFormat;
}

const cache = new Map<string, Formats>();

function formats(): Formats {
	const tag = locale();
	let f = cache.get(tag);
	if (!f) {
		f = {
			date: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' }),
			dateYear: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric' }),
			time: new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }),
			day: new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long' })
		};
		cache.set(tag, f);
	}
	return f;
}

function startOfDay(t: number): number {
	const d = new Date(t);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export function dayDiff(t: number, now: number): number {
	return Math.round((startOfDay(t) - startOfDay(now)) / DAY);
}

/** "today", "yesterday", "3 days ago", "in 2 days", "12 Mar" */
export function relativeDay(t: number | null, now: number): string {
	if (t === null) return '—';
	const d = dayDiff(t, now);
	if (d === 0) return m.time.today;
	if (d === -1) return m.time.yesterday;
	if (d === 1) return m.time.tomorrow;
	if (d < 0 && d > -31) return m.time.daysAgo(-d);
	if (d > 0 && d < 31) return m.time.inDays(d);
	return formatDate(t, now);
}

export function formatDate(t: number | null, now = Date.now()): string {
	if (t === null) return '—';
	return new Date(t).getFullYear() === new Date(now).getFullYear()
		? formats().date.format(t)
		: formats().dateYear.format(t);
}

export function formatDateTime(t: number | null, now = Date.now()): string {
	if (t === null) return '—';
	return `${formatDate(t, now)} ${formatTime(t)}`;
}

export function formatTime(t: number): string {
	return formats().time.format(t);
}

/** Weekday with day and month ("Saturday 24 October"). */
export function formatWeekday(t: number): string {
	return formats().day.format(t);
}

export function formatDayHeading(t: number, now: number): string {
	const d = dayDiff(t, now);
	if (d === 0) return m.time.todayHeading;
	if (d === -1) return m.time.yesterdayHeading;
	const s = formatWeekday(t);
	return s.charAt(0).toLocaleUpperCase(locale()) + s.slice(1);
}

export function formatInterval(days: number | null): string {
	if (days === null) return '—';
	if (days < 1.5) return m.time.everyDay;
	if (days < 13) return m.time.everyDays(Math.round(days));
	const weeks = days / 7;
	if (weeks < 8) return m.time.everyWeeks(Math.round(weeks));
	return m.time.everyMonths(Math.round(days / 30));
}

/** A small number with the language's decimal separator ("1.5" / "1,5"). */
export function formatNumber(n: number): string {
	return language() === 'en' ? String(n) : String(n).replace('.', ',');
}

export function formatPerMonth(perMonth: number | null): string {
	if (perMonth === null) return '—';
	const v = perMonth >= 10 ? Math.round(perMonth) : Math.round(perMonth * 10) / 10;
	return m.time.perMonth(formatNumber(v));
}

export function timeAgo(t: number | null, now: number): string {
	if (t === null) return m.time.never;
	const s = Math.max(0, Math.round((now - t) / 1000));
	if (s < 45) return m.time.justNow;
	const min = Math.round(s / 60);
	if (min < 60) return m.time.minutesAgo(min);
	const h = Math.round(min / 60);
	if (h < 24) return m.time.hoursAgo(h);
	return relativeDay(t, now);
}
