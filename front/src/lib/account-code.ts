export const ACCOUNT_CODE_LENGTH = 3;

export function generateAccountCode(name: string): string {
	const words = name
		.toUpperCase()
		.replace(/[^A-Z0-9\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean);

	if (words.length === 0) return "XXX";

	let raw: string;
	if (words.length >= ACCOUNT_CODE_LENGTH) {
		raw = words
			.slice(0, ACCOUNT_CODE_LENGTH)
			.map((w) => w[0])
			.join("");
	} else if (words.length === 2) {
		raw = words[0][0] + words[1].slice(0, 2);
	} else {
		raw = words[0].slice(0, ACCOUNT_CODE_LENGTH);
	}

	return raw.padEnd(ACCOUNT_CODE_LENGTH, "X").slice(0, ACCOUNT_CODE_LENGTH);
}

export function ensureUniqueAccountCode(
	base: string,
	taken: Set<string>,
): string {
	const normalized = normalizeAccountCode(base);
	if (!taken.has(normalized)) return normalized;

	const prefix = normalized.slice(0, ACCOUNT_CODE_LENGTH - 1);
	for (let digit = 2; digit <= 9; digit++) {
		const candidate = `${prefix}${digit}`;
		if (!taken.has(candidate)) return candidate;
	}

	// Fall back to varying the second-to-last char
	const head = normalized.slice(0, ACCOUNT_CODE_LENGTH - 2);
	for (let a = 0; a < 36; a++) {
		const ch = a.toString(36).toUpperCase();
		for (let digit = 0; digit <= 9; digit++) {
			const candidate = `${head}${ch}${digit}`;
			if (!taken.has(candidate)) return candidate;
		}
	}

	throw new Error("could not find unique account code");
}

export function normalizeAccountCode(value: string): string {
	const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
	if (!cleaned) return "XXX";
	return cleaned.padEnd(ACCOUNT_CODE_LENGTH, "X").slice(0, ACCOUNT_CODE_LENGTH);
}

export function isValidAccountCode(value: string): boolean {
	return /^[A-Z0-9]{3}$/.test(value);
}
