import type { DailyOverviewRow, NutritionDayRow } from './database.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function day(date: string): string {
	return `${date} (${WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]})`;
}

function nextDay(date: string): string {
	const d = new Date(`${date}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}

function num(value: number | null | undefined, digits = 0, suffix = ''): string {
	return value === null || value === undefined ? '–' : `${value.toFixed(digits)}${suffix}`;
}

function average(values: (number | null)[]): number | null {
	const present = values.filter((v): v is number => v !== null && v !== undefined);
	return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

function pearson(pairs: [number, number][]): number | null {
	if (pairs.length < 7) return null;
	const n = pairs.length;
	const mx = pairs.reduce((s, [x]) => s + x, 0) / n;
	const my = pairs.reduce((s, [, y]) => s + y, 0) / n;
	let sxy = 0, sxx = 0, syy = 0;
	for (const [x, y] of pairs) {
		sxy += (x - mx) * (y - my);
		sxx += (x - mx) ** 2;
		syy += (y - my) ** 2;
	}
	return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

const NO_NUTRITION = 'No nutrition data received yet. It arrives from Apple Health (e.g. MyFitnessPal) via the Health Auto Export app, which posts to /ingest/<MCP_SECRET> on this server.';

export function formatNutritionReport(rows: NutritionDayRow[], units: Record<string, string>, days: number): string {
	if (rows.length === 0) return NO_NUTRITION;

	const energyUnit = units.energy ?? 'kcal';
	const weightUnit = units.weight ?? 'kg';
	const hasWeight = rows.some(r => r.weight !== null);

	let out = `# Nutrition (Last ${days} Days)\n\nSource: Apple Health (e.g. MyFitnessPal). Today's values may still be incomplete.\n\n`;
	out += `| Date | Energy | Protein | Carbs | Fat | Fiber | Sugar |${hasWeight ? ' Weight |' : ''}\n`;
	out += `|------|--------|---------|-------|-----|-------|-------|${hasWeight ? '--------|' : ''}\n`;
	for (const r of rows) {
		out += `| ${day(r.date)} | ${num(r.energy, 0, ` ${energyUnit}`)} | ${num(r.protein, 0, ' g')} | ${num(r.carbs, 0, ' g')} | ${num(r.fat, 0, ' g')} | ${num(r.fiber, 0, ' g')} | ${num(r.sugar, 0, ' g')} |${hasWeight ? ` ${num(r.weight, 1, ` ${weightUnit}`)} |` : ''}\n`;
	}

	out += '\n## Averages (days with data)\n';
	out += `- **Energy**: ${num(average(rows.map(r => r.energy)), 0, ` ${energyUnit}`)}\n`;
	out += `- **Protein**: ${num(average(rows.map(r => r.protein)), 0, ' g')}\n`;
	out += `- **Carbs**: ${num(average(rows.map(r => r.carbs)), 0, ' g')}\n`;
	out += `- **Fat**: ${num(average(rows.map(r => r.fat)), 0, ' g')}\n`;
	return out;
}

// Compares the weight change in the period with the logged energy balance.
// Start and end use the mean of up to three weigh-ins to smooth out water swings.
function formatWeightTrend(rows: DailyOverviewRow[], weightUnit: string): string {
	const weighIns = rows.filter(r => r.weight !== null).sort((a, b) => a.date.localeCompare(b.date));
	if (weighIns.length < 2) return '';

	const window = weighIns.length >= 6 ? 3 : 1;
	const first = weighIns.slice(0, window);
	const last = weighIns.slice(-window);
	// Round first so that start, end and change shown to the user add up.
	const start = Math.round((average(first.map(r => r.weight)) as number) * 10) / 10;
	const end = Math.round((average(last.map(r => r.weight)) as number) * 10) / 10;
	const change = Math.round((end - start) * 10) / 10;
	const spanDays = Math.max(1, Math.round((Date.parse(last[last.length - 1].date) - Date.parse(first[0].date)) / 864e5));

	let out = `\n## Weight Trend\n`;
	out += `- **${window > 1 ? 'Start (avg. of first 3 weigh-ins)' : 'Start'}**: ${start.toFixed(1)} ${weightUnit} (${first[0].date})\n`;
	out += `- **${window > 1 ? 'End (avg. of last 3 weigh-ins)' : 'End'}**: ${end.toFixed(1)} ${weightUnit} (${last[last.length - 1].date})\n`;
	out += `- **Change**: ${change > 0 ? '+' : ''}${change.toFixed(1)} ${weightUnit} over ${spanDays} days (${weighIns.length} weigh-ins)\n`;

	const balances = rows
		.filter(r => r.date >= first[0].date && r.date <= last[last.length - 1].date && r.energy !== null && r.calories_burned !== null)
		.map(r => (r.energy as number) - (r.calories_burned as number));
	if (balances.length >= 3 && weightUnit.toLowerCase() === 'kg') {
		const avgBalance = balances.reduce((a, b) => a + b, 0) / balances.length;
		const implied = (avgBalance * spanDays) / 7700;
		out += `- **Avg. energy balance**: ${avgBalance > 0 ? '+' : ''}${avgBalance.toFixed(0)} kcal/day on ${balances.length} logged days, `;
		out += `which would suggest roughly ${implied > 0 ? '+' : ''}${implied.toFixed(1)} kg (7700 kcal ≈ 1 kg)\n`;
		out += 'Rough plausibility check only: days that are not fully logged and the estimate of Whoop calories burned both distort the balance; daily weight also swings with water and glycogen.\n';
	}
	return out;
}

export function formatDailyOverview(rows: DailyOverviewRow[], units: Record<string, string>, days: number): string {
	if (rows.length === 0) return 'No data available for the requested period. Try sync_data first.';

	const energyUnit = units.energy ?? 'kcal';
	const weightUnit = units.weight ?? 'kg';
	const hasWeight = rows.some(r => r.weight !== null);
	let out = `# Daily Overview: Whoop + Nutrition (Last ${days} Days)\n\n`;
	out += 'Recovery, HRV, RHR and sleep belong to the morning of each date (they reflect the previous day and night). ';
	out += 'Strain and "Burned" are the Whoop day (total energy expenditure incl. resting). Balance = Eaten − Burned. ';
	out += "To judge how food affects recovery, compare a day's intake with the NEXT day's recovery. Today's values may be incomplete.\n\n";
	out += `| Date | Recovery | HRV | RHR | Sleep | Sleep perf. | Strain | Burned | Eaten | Balance | Protein | Carbs | Fat |${hasWeight ? ' Weight |' : ''}\n`;
	out += `|------|----------|-----|-----|-------|-------------|--------|--------|-------|---------|---------|-------|-----|${hasWeight ? '--------|' : ''}\n`;
	for (const r of rows) {
		const balance = r.energy !== null && r.calories_burned !== null ? r.energy - r.calories_burned : null;
		out += `| ${day(r.date)} | ${num(r.recovery_score, 0, '%')} | ${num(r.hrv, 1, ' ms')} | ${num(r.rhr, 0)} | ${num(r.sleep_hours, 1, ' h')} | ${num(r.sleep_performance, 0, '%')} | ${num(r.strain, 1)} | ${num(r.calories_burned, 0)} | ${num(r.energy, 0)} | ${balance === null ? '–' : `${balance > 0 ? '+' : ''}${balance.toFixed(0)}`} | ${num(r.protein, 0, ' g')} | ${num(r.carbs, 0, ' g')} | ${num(r.fat, 0, ' g')} |${hasWeight ? ` ${num(r.weight, 1, ` ${weightUnit}`)} |` : ''}\n`;
	}
	out += `\nEnergy values in ${energyUnit}.\n`;
	out += formatWeightTrend(rows, weightUnit);

	// Correlations with next-day recovery (only complete past days, n >= 7).
	const today = new Date().toISOString().slice(0, 10);
	const byDate = new Map(rows.map(r => [r.date, r]));
	const nextRecovery = (r: DailyOverviewRow): number | null => byDate.get(nextDay(r.date))?.recovery_score ?? null;
	const past = rows.filter(r => r.date < today);
	const lagged = (pick: (r: DailyOverviewRow) => number | null): [number, number][] =>
		past.flatMap(r => {
			const x = pick(r);
			const y = nextRecovery(r);
			return x !== null && y !== null ? [[x, y] as [number, number]] : [];
		});

	const checks: [string, [number, number][]][] = [
		['Energy eaten (day) → recovery (next day)', lagged(r => r.energy)],
		['Protein (day) → recovery (next day)', lagged(r => r.protein)],
		['Carbs (day) → recovery (next day)', lagged(r => r.carbs)],
		['Energy balance (day) → recovery (next day)', lagged(r => (r.energy !== null && r.calories_burned !== null ? r.energy - r.calories_burned : null))],
		['Strain (day) → recovery (next day)', lagged(r => r.strain)],
		['Sleep hours → recovery (same morning)', rows.flatMap(r => (r.sleep_hours !== null && r.recovery_score !== null ? [[r.sleep_hours, r.recovery_score] as [number, number]] : []))],
	];

	const lines = checks
		.map(([label, pairs]) => {
			const r = pearson(pairs);
			return r === null ? null : `- ${label}: r = ${r.toFixed(2)} (n = ${pairs.length})`;
		})
		.filter((line): line is string => line !== null);

	if (lines.length) {
		out += '\n## Correlations (Pearson r, -1..+1)\n';
		out += 'Rough indicators only: small samples and many other factors (alcohol, stress, illness, travel) influence recovery.\n';
		out += `${lines.join('\n')}\n`;
	}
	return out;
}
