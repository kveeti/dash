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

export type TransactionWindowOrigin = {
	top: number;
	right: number;
};

type TransactionWindowsContextValue = {
	openTransaction: (txId: string, origin?: TransactionWindowOrigin) => void;
	closeTransaction: (txId: string) => void;
};

const TransactionWindowsContext =
	createContext<TransactionWindowsContextValue | null>(null);

export function TransactionWindowsProvider({ children }: { children: ReactNode }) {
	const [openIds, setOpenIds] = useState<Array<string>>([]);
	const [origins, setOrigins] = useState<Map<string, TransactionWindowOrigin>>(
		() => new Map(),
	);
	const refs = useRef<Map<string, SelectedTxHandle>>(new Map());

	const openTransaction = useCallback((txId: string, origin?: TransactionWindowOrigin) => {
		if (origin) {
			setOrigins((prev) => new Map(prev).set(txId, origin));
		}
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
		setOrigins((prev) => {
			const next = new Map(prev);
			next.delete(txId);
			return next;
		});
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
					origin={origins.get(id)}
					onClose={() => closeTransaction(id)}
					onOpenTransaction={openTransaction}
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
