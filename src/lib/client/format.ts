/** Dutch date formatting helpers. */

import { DAY } from '$lib/shared/stats';

const dateFmt = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short' });
const dateYearFmt = new Intl.DateTimeFormat('nl-NL', {
	day: 'numeric',
	month: 'short',
	year: 'numeric'
});
const timeFmt = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });

function startOfDay(t: number): number {
	const d = new Date(t);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export function dayDiff(t: number, now: number): number {
	return Math.round((startOfDay(t) - startOfDay(now)) / DAY);
}

/** "vandaag", "gisteren", "3 dagen geleden", "over 2 dagen", "12 mrt." */
export function relativeDay(t: number | null, now: number): string {
	if (t === null) return '—';
	const d = dayDiff(t, now);
	if (d === 0) return 'vandaag';
	if (d === -1) return 'gisteren';
	if (d === 1) return 'morgen';
	if (d < 0 && d > -31) return `${-d} dagen geleden`;
	if (d > 0 && d < 31) return `over ${d} dagen`;
	return formatDate(t, now);
}

export function formatDate(t: number | null, now = Date.now()): string {
	if (t === null) return '—';
	return new Date(t).getFullYear() === new Date(now).getFullYear()
		? dateFmt.format(t)
		: dateYearFmt.format(t);
}

export function formatDateTime(t: number | null, now = Date.now()): string {
	if (t === null) return '—';
	return `${formatDate(t, now)} ${timeFmt.format(t)}`;
}

export function formatDayHeading(t: number, now: number): string {
	const d = dayDiff(t, now);
	if (d === 0) return 'Vandaag';
	if (d === -1) return 'Gisteren';
	const s = dayFmt.format(t);
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatInterval(days: number | null): string {
	if (days === null) return '—';
	if (days < 1.5) return 'elke dag';
	if (days < 13) return `elke ${Math.round(days)} dagen`;
	const weeks = days / 7;
	if (weeks < 8) return `elke ${Math.round(weeks)} weken`;
	return `elke ${Math.round(days / 30)} maanden`;
}

export function formatPerMonth(perMonth: number | null): string {
	if (perMonth === null) return '—';
	const v = perMonth >= 10 ? Math.round(perMonth) : Math.round(perMonth * 10) / 10;
	return `${String(v).replace('.', ',')}× per maand`;
}

export function timeAgo(t: number | null, now: number): string {
	if (t === null) return 'nog nooit';
	const s = Math.max(0, Math.round((now - t) / 1000));
	if (s < 45) return 'zojuist';
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min geleden`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} uur geleden`;
	return relativeDay(t, now);
}
