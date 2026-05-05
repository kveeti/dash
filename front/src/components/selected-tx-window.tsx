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

export function SelectedTxWindow({
	txId,
	index,
	onClose,
	onOpenTransaction,
	ref: forwardedRef,
}: {
	txId: string;
	index: number;
	onClose: () => void;
	onOpenTransaction: (txId: string) => void;
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

	const stackOffset = { x: 0, y: (index + 1) * 72 };

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
				<div className="flex items-center gap-2 px-3">
					<button
						type="button"
						onClick={() => setEditing(!editing)}
						className="text-sm text-gray-11 hover:text-gray-12"
					>
						{editing ? "hide edit" : "edit"}
					</button>
					<span className="text-gray-a4">|</span>
					<SelectedTxCopyIdButton txId={txId} />
					<span className="text-gray-a4">|</span>
					<button
						type="button"
						onClick={() => setShowLinking(!showLinking)}
						className="text-sm text-gray-11 hover:text-gray-12"
					>
						{showLinking ? "hide links" : "links"}
					</button>
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
