import type { QueryClient } from "@tanstack/react-query";
import { queryKeyRoots } from "./queries/query-keys";

export const dbChangeRoots = [
	"accounts",
	"categories",
	"transactions",
	"transaction",
	"transactionFlows",
	"transactionLinkSuggestions",
	"tags",
	"stats",
	"settings",
	"fxRates",
] as const;

export type DbChangeRoot = (typeof dbChangeRoots)[number];

const DB_CHANGE_CHANNEL = "dash:db-change:v1";
const TAB_ID = globalThis.crypto?.randomUUID?.() ?? String(Math.random());
const dbChangeRootSet = new Set<string>(dbChangeRoots);

type DbChangeMessage = {
	type: "db-change";
	senderId: string;
	roots: DbChangeRoot[];
	at: number;
};

let channel: BroadcastChannel | null | undefined;

function getChannel() {
	if (channel !== undefined) return channel;
	if (typeof BroadcastChannel === "undefined") {
		channel = null;
		return null;
	}
	channel = new BroadcastChannel(DB_CHANGE_CHANNEL);
	return channel;
}

function isDbChangeMessage(message: unknown): message is DbChangeMessage {
	if (!message || typeof message !== "object") return false;
	const candidate = message as Partial<DbChangeMessage>;
	return (
		candidate.type === "db-change" &&
		typeof candidate.senderId === "string" &&
		Array.isArray(candidate.roots) &&
		candidate.roots.every((root) => dbChangeRootSet.has(root))
	);
}

export function broadcastDbChange(roots: DbChangeRoot[]) {
	const uniqueRoots = Array.from(new Set(roots));
	if (uniqueRoots.length === 0) return;
	getChannel()?.postMessage({
		type: "db-change",
		senderId: TAB_ID,
		roots: uniqueRoots,
		at: Date.now(),
	} satisfies DbChangeMessage);
}

export function listenForDbChanges(
	onChange: (roots: DbChangeRoot[]) => void,
) {
	const broadcastChannel = getChannel();
	if (!broadcastChannel) return () => {};

	const onMessage = (event: MessageEvent<unknown>) => {
		if (!isDbChangeMessage(event.data)) return;
		if (event.data.senderId === TAB_ID) return;
		onChange(event.data.roots);
	};

	broadcastChannel.addEventListener("message", onMessage);
	return () => broadcastChannel.removeEventListener("message", onMessage);
}

export function invalidateDbChangeQueries(
	qc: QueryClient,
	roots: DbChangeRoot[],
) {
	for (const root of new Set(roots)) {
		qc.invalidateQueries({ queryKey: queryKeyRoots[root] });
	}
}
