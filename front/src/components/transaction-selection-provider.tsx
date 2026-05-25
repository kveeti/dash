import {
	useCallback,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { TransactionSelectionContext } from "./transaction-selection-context";

export function TransactionSelectionProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	const toggle = useCallback((txId: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(txId)) next.delete(txId);
			else next.add(txId);
			return next;
		});
	}, []);

	const clear = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	const selectedTxIds = useMemo(() => [...selectedIds], [selectedIds]);

	const value = useMemo(
		() => ({
			selectedIds,
			selectedTxIds,
			isSelecting: selectedIds.size > 0,
			toggle,
			clear,
		}),
		[clear, selectedIds, selectedTxIds, toggle],
	);

	return (
		<TransactionSelectionContext.Provider value={value}>
			{children}
		</TransactionSelectionContext.Provider>
	);
}
