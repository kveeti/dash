export function parseStringArrayParam(value: string | null) {
	if (!value) return [];
	return Array.from(
		new Set(
			value
				.split(",")
				.map((part) => part.trim())
				.filter(Boolean),
		),
	);
}

export function formatStringArrayParam(values: string[]) {
	return values.length ? values.join(",") : undefined;
}
