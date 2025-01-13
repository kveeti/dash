import { endOfYear, startOfYear } from "date-fns";
import { subYears } from "date-fns/subYears";

import { trpc } from "../../lib/trpc";

export function TransactionStatsPage() {
	const now = new Date();
	const lastYear = subYears(now, 1);

	const q = trpc.v1.transactions.stats.useQuery({
		timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		start: startOfYear(lastYear),
		end: endOfYear(lastYear),
		frequency: "monthly",
	});

	return <div>stats</div>;
}
