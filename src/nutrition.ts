// Ingests Apple Health data sent by the "Health Auto Export" iOS app
// (REST API automation, JSON format). MyFitnessPal writes its food log to
// Apple Health, so this is how nutrition data reaches the server.
//
// Payload shape: { data: { metrics: [{ name, units, data: [{ qty, date }] }] } }
// Dates look like "2026-09-21 00:00:00 +0200"; the first 10 characters are the
// local calendar day, which is what we store.

export interface NutritionRow {
	date: string;
	metric: string;
	qty: number;
	units: string;
}

type Aggregation = 'sum' | 'avg';

// Health Auto Export metric name -> stored metric name + how to combine
// several samples of the same day.
const METRICS: Record<string, { key: string; agg: Aggregation }> = {
	dietary_energy: { key: 'energy', agg: 'sum' },
	protein: { key: 'protein', agg: 'sum' },
	carbohydrates: { key: 'carbs', agg: 'sum' },
	total_fat: { key: 'fat', agg: 'sum' },
	fiber: { key: 'fiber', agg: 'sum' },
	dietary_sugar: { key: 'sugar', agg: 'sum' },
	sodium: { key: 'sodium', agg: 'sum' },
	dietary_water: { key: 'water', agg: 'sum' },
	'weight_&_body_mass': { key: 'weight', agg: 'avg' },
	weight_body_mass: { key: 'weight', agg: 'avg' },
};

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

interface RawPoint {
	qty?: unknown;
	date?: unknown;
}

interface RawMetric {
	name?: unknown;
	units?: unknown;
	data?: unknown;
}

export function parseHealthExport(body: unknown): NutritionRow[] {
	const metrics = (body as { data?: { metrics?: unknown } } | null)?.data?.metrics;
	if (!Array.isArray(metrics)) {
		throw new Error('Expected a Health Auto Export JSON payload with data.metrics');
	}

	const buckets = new Map<string, { metric: string; date: string; units: string; agg: Aggregation; total: number; count: number }>();

	for (const raw of metrics as RawMetric[]) {
		const config = typeof raw?.name === 'string' ? METRICS[raw.name] : undefined;
		if (!config || !Array.isArray(raw.data)) continue;

		let units = typeof raw.units === 'string' ? raw.units : '';
		// Apple Health may report food energy in kJ depending on locale.
		const toKcal = config.key === 'energy' && units.toLowerCase() === 'kj';
		if (toKcal) units = 'kcal';

		for (const point of raw.data as RawPoint[]) {
			const qty = typeof point?.qty === 'number' ? point.qty : Number.NaN;
			const match = typeof point?.date === 'string' ? DATE_PREFIX.exec(point.date) : null;
			if (!Number.isFinite(qty) || !match) continue;

			const date = match[1];
			const bucketKey = `${date}|${config.key}`;
			const bucket = buckets.get(bucketKey) ?? { metric: config.key, date, units, agg: config.agg, total: 0, count: 0 };
			bucket.total += toKcal ? qty / 4.184 : qty;
			bucket.count += 1;
			buckets.set(bucketKey, bucket);
		}
	}

	return [...buckets.values()].map(b => ({
		date: b.date,
		metric: b.metric,
		qty: b.agg === 'avg' ? b.total / b.count : b.total,
		units: b.units,
	}));
}
