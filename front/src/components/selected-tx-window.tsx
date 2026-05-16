import {
	useImperativeHandle,
	useRef,
	useState,
	type Ref,
} from "react";
import { useI18n } from "../providers";
import { useTransactionQuery } from "../lib/queries/transactions";
import { SelectedTx, type SelectedTxHandle } from "./selected-tx";
import { SelectedTxEditPanel } from "./selected-tx-edit-panel";
import { resolveAmountDisplay } from "./selected-tx-flow-logic";
import { SelectedTxHeader } from "./selected-tx-header";
import { SelectedTxLinksPanel } from "./selected-tx-links-panel";
import { SelectedTxCopyIdButton } from "./selected-tx-copy-id-button";
import { SelectedTxQuickEditPanel } from "./selected-tx-quick-edit-panel";
import type { TransactionWindowOrigin } from "./transaction-windows";

export function SelectedTxWindow({
	txId,
	index,
	origin,
	onClose,
	onOpenTransaction,
	ref: forwardedRef,
}: {
	txId: string;
	index: number;
	origin?: TransactionWindowOrigin;
	onClose: () => void;
	onOpenTransaction: (txId: string, origin?: TransactionWindowOrigin) => void;
	ref?: Ref<SelectedTxHandle>;
}) {
	const { f } = useI18n();
	const [editing, setEditing] = useState(false);
	const [showLinking, setShowLinking] = useState(false);
	const selectedTxRef = useRef<SelectedTxHandle>(null);
	const txQuery = useTransactionQuery(txId);

	useImperativeHandle(forwardedRef, () => ({
		nudge: () => selectedTxRef.current?.nudge(),
	}));

	if (!txQuery.data) {
		return;
	}
	const tx = txQuery.data;
	const txAmountDisplay = resolveAmountDisplay(tx);

	const stackOffset = getInitialOffset(index, origin);

	return (
		<SelectedTx
			ref={selectedTxRef}
			id={txId}
			label={`Transaction: ${tx.counter_party}, ${f.amount(txAmountDisplay.amount, txAmountDisplay.currency)}`}
			onClose={onClose}
			initialOffset={stackOffset}
		>
			<SelectedTxHeader amountDisplay={txAmountDisplay} tx={tx} />

			<div className="my-3 space-y-2">
				<SelectedTxQuickEditPanel tx={tx} txId={txId} />

				<div className="flex items-center gap-2 px-3">
					<button
						type="button"
						onClick={() => setEditing(!editing)}
						className="text-sm text-gray-11 hover:text-gray-12"
					>
						{editing ? "hide edit" : "edit"}
					</button>
					<span className="text-gray-a4">|</span>
					<button
						type="button"
						onClick={() => setShowLinking(!showLinking)}
						className="text-sm text-gray-11 hover:text-gray-12"
					>
						{showLinking ? "hide flows" : "flows"}
					</button>
					<span className="text-gray-a4">|</span>
					<SelectedTxCopyIdButton txId={txId} />
				</div>

				<SelectedTxEditPanel
					open={editing}
					tx={tx}
					txId={txId}
					onClose={() => setEditing(false)}
				/>

				<SelectedTxLinksPanel
					open={showLinking}
					tx={tx}
					txId={txId}
					onOpenTransaction={onOpenTransaction}
				/>
			</div>
		</SelectedTx>
	);
}

function getInitialOffset(
	index: number,
	origin: TransactionWindowOrigin | undefined,
) {
	const defaultLeft = window.innerWidth - 384 - 19;
	const defaultTop = 37;
	if (!origin) return { x: 0, y: index * 28 };

	const windowWidth = Math.min(384, window.innerWidth * 0.9);
	const targetLeft = Math.min(
		Math.max(16, origin.right + 8),
		Math.max(16, window.innerWidth - windowWidth - 16),
	);
	const targetTop = Math.min(
		Math.max(16, origin.top - 18),
		Math.max(16, window.innerHeight - 240),
	);

	return {
		x: targetLeft - defaultLeft,
		y: targetTop - defaultTop + index * 12,
	};
}
