const pad = (value: number) => String(value).padStart(2, '0');
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

export function isIsoDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
	return date.toISOString().slice(0, 10) === value;
}

/** Today's date where the user lives; the server itself runs in UTC. */
export function todayInSaoPaulo(now = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

/**
 * The date the app gives a credit card purchase: the due date of the invoice it falls into.
 * A purchase after the closing day goes to the next invoice; a due day on or before the
 * closing day belongs to the month after the closing. Days past a month's end clamp to its
 * last day. Mirrors the app's own calculation.
 */
export function invoiceDueDate(purchase: string, closingDay: number, dueDay: number): string {
	const [year, month, day] = purchase.split('-').map(Number) as [number, number, number];
	// Months are counted from year 0 so adding one never needs a year carry.
	let months = year * 12 + (month - 1);
	const clamp = (at: number, wanted: number) => {
		const last = new Date(Date.UTC(Math.floor(at / 12), (at % 12) + 1, 0)).getUTCDate();
		return Math.min(Math.max(Math.trunc(wanted), 1), last);
	};
	if (day > clamp(months, closingDay)) months += 1;
	const closing = clamp(months, closingDay);
	let dueMonths = months;
	if (clamp(months, dueDay) <= closing) dueMonths += 1;
	return iso(Math.floor(dueMonths / 12), (dueMonths % 12) + 1, clamp(dueMonths, dueDay));
}
