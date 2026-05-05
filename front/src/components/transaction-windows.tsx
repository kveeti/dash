import {
	createContext,
	useCallback,
	useContext,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { type SelectedTxHandle } from "./selected-tx";
import { SelectedTxWindow } from "./selected-tx-window";

type TransactionWindowsContextValue = {
	openTransaction: (txId: string) => void;
	closeTransaction: (txId: string) => void;
};

const TransactionWindowsContext =
	createContext<TransactionWindowsContextValue | null>(null);

export function TransactionWindowsProvider({ children }: { children: ReactNode }) {
	const [openIds, setOpenIds] = useState<Array<string>>([]);
	const refs = useRef<Map<string, SelectedTxHandle>>(new Map());

	const openTransaction = useCallback((txId: string) => {
		setOpenIds((prev) => {
			if (prev.includes(txId)) {
				refs.current.get(txId)?.nudge();
				return prev;
			}
			return [...prev, txId];
		});
	}, []);

	const closeTransaction = useCallback((txId: string) => {
		setOpenIds((prev) => prev.filter((id) => id !== txId));
	}, []);

	function setRef(id: string, handle: SelectedTxHandle | null) {
		if (handle) refs.current.set(id, handle);
		else refs.current.delete(id);
	}

	return (
		<TransactionWindowsContext.Provider
			value={{ openTransaction, closeTransaction }}
		>
			{children}
			{openIds.map((id, index) => (
				<SelectedTxWindow
					key={id}
					txId={id}
					index={index}
					onClose={() => closeTransaction(id)}
					ref={(handle) => setRef(id, handle)}
				/>
			))}
		</TransactionWindowsContext.Provider>
	);
}

export function useTransactionWindows() {
	const context = useContext(TransactionWindowsContext);
	if (!context) {
		throw new Error(
			"useTransactionWindows must be used within TransactionWindowsProvider",
		);
	}
	return context;
}
