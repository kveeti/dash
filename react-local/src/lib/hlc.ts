export type HLC = ReturnType<typeof getHLCGenerator>;

export function getHLCGenerator(clientId: string) {
	if (!clientId) throw new Error("A unique clientId is required");

	let lastTime = Date.now();
	let counter = 0;

	/**
	 * Call this whenever the local client creates or updates a record.
	 * Returns a strictly sortable string timestamp.
	 */
	function generate() {
		const now = Date.now();

		if (now > lastTime) {
			// Physical time moved forward normally
			lastTime = now;
			counter = 0;
		} else {
			// Physical time is exactly the same, OR the clock drifted backwards.
			// We keep lastTime exactly as it was, but increment the counter.
			counter++;
		}

		return format(lastTime, counter, clientId);
	}

	/**
	 * Call this when receiving a synced record from the server.
	 * This ensures the local clock catches up to any remote clocks.
	 */
	function receive(hlc: string) {
		const remote = parse(hlc);
		const now = Date.now();

		// The new time is the highest of: current time, last local time, or incoming remote time
		const maxTime = Math.max(now, lastTime, remote.time);

		// Determine the new counter based on which time "won"
		if (maxTime === lastTime && maxTime === remote.time) {
			counter = Math.max(counter, remote.counter) + 1;
		} else if (maxTime === lastTime) {
			counter++;
		} else if (maxTime === remote.time) {
			counter = remote.counter + 1;
		} else {
			counter = 0;
		}

		lastTime = maxTime;

		return format(lastTime, counter, clientId);
	};

	return {
		generate,
		receive
	}
}

/**
 * Formats the HLC into a lexicographically sortable string.
 * Padding ensures that standard string comparison (A > B) works perfectly.
 */
function format(time: number, counter: number, node: string) {
	// Pad time to 15 digits (safe until the year 33658)
	const tString = time.toString().padStart(15, '0');
	// Pad counter to 5 digits (allows 99,999 operations per exact millisecond)
	const cString = counter.toString().padStart(5, '0');

	return `${tString}-${cString}-${node}`;
};

/**
 * Helper to break an HLC string back down into its parts.
 */
function parse(hlc: string) {
	const [t, c, node] = hlc.split('-');
	return {
		time: parseInt(t, 10),
		counter: parseInt(c, 10),
		node
	};
}
