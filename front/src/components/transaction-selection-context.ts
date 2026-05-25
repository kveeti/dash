import { createContext, useContext } from "react";

export type TransactionSelectionValue = {
	selectedIds: Set<string>;
	selectedTxIds: string[];
	isSelecting: boolean;
	toggle: (txId: string) => void;
	clear: () => void;
};

export const TransactionSelectionContext =
	createContext<TransactionSelectionValue | null>(null);

export function useTransactionSelection() {
	const context = useContext(TransactionSelectionContext);
	if (!context) {
		throw new Error(
			"useTransactionSelection must be used within TransactionSelectionProvider",
		);
	}
	return context;
}
