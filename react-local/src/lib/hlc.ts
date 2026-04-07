const DEVICE_ID_KEY = "dash_device_id";

function randomHex(bytes: number): string {
	const arr = crypto.getRandomValues(new Uint8Array(bytes));
	return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getDeviceId(): string {
	let id = localStorage.getItem(DEVICE_ID_KEY);
	if (!id) {
		id = randomHex(4); // 8 hex chars
		localStorage.setItem(DEVICE_ID_KEY, id);
	}
	return id;
}

export function clearDeviceId(): void {
	localStorage.removeItem(DEVICE_ID_KEY);
}

/**
 * HLC format: <timestamp_ms_hex_12>-<counter_hex_4>-<device_id_8>
 * Example: 018ec5a1b000-0001-a3f2c9d1
 *
 * Lexicographic string comparison = causal ordering.
 */
export function makeHlc(now: number, lastHlc: string | null): string {
	const deviceId = getDeviceId();

	if (!lastHlc) {
		return formatHlc(now, 0, deviceId);
	}

	const { ts: lastTs, counter: lastCounter } = parseHlc(lastHlc);

	if (now > lastTs) {
		return formatHlc(now, 0, deviceId);
	}

	// Wall clock hasn't advanced — increment counter
	return formatHlc(lastTs, lastCounter + 1, deviceId);
}

export function batchHlc(now: number, lastHlc: string | null, count: number): string[] {
	const deviceId = getDeviceId();
	const result: string[] = [];

	let ts: number;
	let counter: number;

	if (!lastHlc) {
		ts = now;
		counter = 0;
	} else {
		const parsed = parseHlc(lastHlc);
		if (now > parsed.ts) {
			ts = now;
			counter = 0;
		} else {
			ts = parsed.ts;
			counter = parsed.counter + 1;
		}
	}

	for (let i = 0; i < count; i++) {
		result.push(formatHlc(ts, counter + i, deviceId));
	}

	return result;
}

export function compareHlc(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

function formatHlc(ts: number, counter: number, deviceId: string): string {
	const tsHex = ts.toString(16).padStart(12, "0");
	const counterHex = counter.toString(16).padStart(4, "0");
	return `${tsHex}-${counterHex}-${deviceId}`;
}

function parseHlc(hlc: string): { ts: number; counter: number; deviceId: string } {
	const parts = hlc.split("-");
	return {
		ts: parseInt(parts[0], 16),
		counter: parseInt(parts[1], 16),
		deviceId: parts[2],
	};
}
