import { AnimatePresence, motion } from "framer-motion";
import {
	useImperativeHandle,
	useRef,
	useState,
	type Ref,
} from "react";
import { useI18n } from "../providers";
import {
	type TransactionDetails,
	type TransactionFlow,
	type TransactionFlowKind,
	useCreateTransactionFlowMutation,
	useDeleteTransactionFlowMutation,
	useDismissTransactionLinkSuggestionMutation,
	useTransactionFlowsQuery,
	useTransactionLinkSuggestionsQuery,
	useTransactionQuery,
	useUpdateTransactionMutation,
} from "../lib/queries/transactions";
import { Button } from "./button";
import { Select } from "./select";
import { SelectedTx, type SelectedTxHandle } from "./selected-tx";
import { TransactionForm } from "./transaction-form";

function resolveAmountDisplay(
	tx: {
		amount: number;
		currency: string;
		converted_amount: number | null;
		converted_currency: string;
	},
) {
	if (tx.converted_amount == null) {
		return {
			amount: tx.amount,
			currency: tx.currency,
			original: null as { amount: number; currency: string } | null,
		};
	}

	const convertedCurrency = tx.converted_currency;
	const wasConverted = tx.currency !== convertedCurrency;

	return {
		amount: tx.converted_amount,
		currency: convertedCurrency,
		original: wasConverted
			? { amount: tx.amount, currency: tx.currency }
			: null,
	};
}

function sumFlowAmounts(
	flows: TransactionFlow[] | undefined,
	predicate: (flow: TransactionFlow) => boolean,
) {
	return (flows ?? []).reduce(
		(total, flow) => total + (predicate(flow) ? flow.amount : 0),
		0,
	);
}

function getAvailableFlowAmount(
	tx: TransactionDetails | undefined,
	flows: TransactionFlow[] | undefined,
	kind: TransactionFlowKind,
) {
	if (!tx) return 0;
	if (kind === "own_transfer") {
		const moved = sumFlowAmounts(
			flows,
			(flow) => flow.kind === "own_transfer",
		);
		return Math.max(0, Math.abs(tx.amount) - moved);
	}

	if (tx.amount > 0) {
		const used = sumFlowAmounts(
			flows,
			(flow) =>
				flow.direction === "outgoing" &&
				(flow.kind === "allocation" || flow.kind === "refund"),
		);
		return Math.max(0, tx.amount - used);
	}

	const covered = sumFlowAmounts(
		flows,
		(flow) =>
			flow.direction === "incoming" &&
			(flow.kind === "allocation" || flow.kind === "refund"),
	);
	return Math.max(0, Math.abs(tx.amount) - covered);
}

function inferFlowDirection({
	selected,
	target,
	kind,
}: {
	selected: TransactionDetails;
	target: TransactionDetails;
	kind: TransactionFlowKind;
}) {
	if (kind === "own_transfer") {
		if (selected.amount < 0 && target.amount > 0) {
			return {
				from_transaction_id: selected.id,
				to_transaction_id: target.id,
			};
		}
		if (selected.amount > 0 && target.amount < 0) {
			return {
				from_transaction_id: target.id,
				to_transaction_id: selected.id,
			};
		}
		return null;
	}

	if (selected.amount > 0 && target.amount < 0) {
		return {
			from_transaction_id: selected.id,
			to_transaction_id: target.id,
		};
	}
	if (selected.amount < 0 && target.amount > 0) {
		return {
			from_transaction_id: target.id,
			to_transaction_id: selected.id,
		};
	}
	return null;
}

export function SelectedTxWindow({
	txId,
	index,
	onClose,
	ref: forwardedRef,
}: {
	txId: string;
	index: number;
	onClose: () => void;
	ref?: Ref<SelectedTxHandle>;
}) {
	const { f } = useI18n();
	const [editing, setEditing] = useState(false);
	const [flowTargetInput, setFlowTargetInput] = useState("");
	const [flowKind, setFlowKind] = useState<TransactionFlowKind>("allocation");
	const [flowAmountInput, setFlowAmountInput] = useState("");
	const [copied, setCopied] = useState(false);
	const selectedTxRef = useRef<SelectedTxHandle>(null);
	const targetTxId = flowTargetInput.trim();
	const txQuery = useTransactionQuery(txId);
	const targetTxQuery = useTransactionQuery(
		targetTxId && targetTxId !== txId ? targetTxId : undefined,
	);
	const updateTransaction = useUpdateTransactionMutation();
	const flowsQuery = useTransactionFlowsQuery(txId);
	const targetFlowsQuery = useTransactionFlowsQuery(
		targetTxId && targetTxId !== txId ? targetTxId : undefined,
	);
	const linkSuggestionsQuery = useTransactionLinkSuggestionsQuery(txId);
	const createFlowMutation = useCreateTransactionFlowMutation();
	const deleteFlowMutation = useDeleteTransactionFlowMutation();
	const dismissLinkSuggestionMutation = useDismissTransactionLinkSuggestionMutation();

	useImperativeHandle(forwardedRef, () => ({
		nudge: () => selectedTxRef.current?.nudge(),
	}));

	if (!txQuery.data) {
		return;
	}
	const tx = txQuery.data;
	const txAmountDisplay = resolveAmountDisplay(tx);
	const targetTx = targetTxQuery.data;
	const flowDirection = targetTx
		? inferFlowDirection({ selected: tx, target: targetTx, kind: flowKind })
		: null;
	const flowAmount = Number(flowAmountInput.replace(",", "."));
	const canCreateFlow =
		!!flowDirection &&
		!!targetTx &&
		tx.currency === targetTx.currency &&
		Number.isFinite(flowAmount) &&
		flowAmount > 0;
	const allocationUsed = sumFlowAmounts(
		flowsQuery.data,
		(flow) =>
			flow.direction === "outgoing" &&
			(flow.kind === "allocation" || flow.kind === "refund"),
	);
	const allocationCovered = sumFlowAmounts(
		flowsQuery.data,
		(flow) =>
			flow.direction === "incoming" &&
			(flow.kind === "allocation" || flow.kind === "refund"),
	);
	const ownTransferMoved = sumFlowAmounts(
		flowsQuery.data,
		(flow) => flow.kind === "own_transfer",
	);
	const txAvailable = Math.max(0, tx.amount > 0 ? tx.amount - allocationUsed : 0);
	const txRemaining = Math.max(
		0,
		tx.amount < 0 ? Math.abs(tx.amount) - allocationCovered : 0,
	);
	const txOverfunded = Math.max(
		0,
		tx.amount < 0 ? allocationCovered - Math.abs(tx.amount) : 0,
	);
	const suggestedFlowAmount = (() => {
		if (!targetTx || !flowDirection || tx.currency !== targetTx.currency) return 0;
		const selectedAvailable = getAvailableFlowAmount(tx, flowsQuery.data, flowKind);
		const targetAvailable = getAvailableFlowAmount(
			targetTx,
			targetFlowsQuery.data,
			flowKind,
		);
		const amount =
			flowKind === "own_transfer"
				? Math.min(Math.abs(tx.amount), Math.abs(targetTx.amount))
				: Math.min(selectedAvailable, targetAvailable);
		return Math.max(0, Math.round(amount * 100) / 100);
	})();

	const isIncome = txAmountDisplay.amount > 0;
	const stackOffset = { x: 0, y: (index + 1) * 72 };

	function copyId() {
		navigator.clipboard.writeText(txId);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}

	async function handleCreateFlow() {
		const target = targetTxQuery.data;
		if (!target || target.id === txId) return;
		const direction = inferFlowDirection({ selected: tx, target, kind: flowKind });
		if (!direction) return;
		const amount = Number(flowAmountInput.replace(",", "."));
		if (!Number.isFinite(amount) || amount <= 0) return;
		await createFlowMutation.mutateAsync({
			...direction,
			amount,
			currency: tx.currency,
			kind: flowKind,
		});
		setFlowTargetInput("");
		setFlowAmountInput("");
	}

	async function acceptLinkSuggestion(
		flows: Array<{
			from_transaction_id: string;
			to_transaction_id: string;
			amount: number;
			currency: string;
			kind: "own_transfer" | "allocation" | "refund";
		}>,
	) {
		for (const flow of flows) {
			await createFlowMutation.mutateAsync(flow);
		}
	}

	return (
		<SelectedTx
			ref={selectedTxRef}
			id={txId}
			label={`Transaction: ${tx.counter_party}, ${f.amount(txAmountDisplay.amount, txAmountDisplay.currency)}`}
			onClose={onClose}
			initialOffset={stackOffset}
		>
			<div className="space-y-1 px-3 pt-3">
				<h2 className="font-medium">{tx.counter_party}</h2>
				<p className={`text-sm ${isIncome ? "text-green-11" : ""}`}>
					{f.amount(txAmountDisplay.amount, txAmountDisplay.currency)}
				</p>
				{txAmountDisplay.original && (
					<p className="text-xs text-gray-11">
						({f.amount(txAmountDisplay.original.amount, txAmountDisplay.original.currency)})
					</p>
				)}
				<p className="text-xs">{f.weekdayLongDate.format(new Date(tx.date))}</p>
			</div>

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
					<button
						type="button"
						onClick={copyId}
						className="text-sm text-gray-11 hover:text-gray-12"
					>
						{copied ? "copied!" : "copy id"}
					</button>
				</div>

				<AnimatePresence>
					{editing && (
						<motion.div
							initial={{ height: 0, opacity: 0 }}
							animate={{ height: "auto", opacity: 1 }}
							exit={{ height: 0, opacity: 0 }}
							transition={{ duration: 0.15 }}
							className="overflow-hidden"
						>
							<div className="px-3">
								<TransactionForm
									defaultValues={{
										date: tx.date,
										amount: tx.amount,
										currency: tx.currency,
										counter_party: tx.counter_party,
										additional: tx.additional ?? undefined,
										notes: tx.notes ?? undefined,
										category_id: tx.category_id ?? undefined,
										account_id: tx.account_id,
									}}
									isSubmitting={updateTransaction.isPending}
									onSubmit={async (values) => {
										await updateTransaction.mutateAsync({ txId, tx: values });
										setEditing(false);
									}}
									actions={
										<>
											<Button
												type="button"
												variant="ghost"
												disabled={updateTransaction.isPending}
												onClick={() => setEditing(false)}
											>
												cancel
											</Button>
											<Button
												type="submit"
												isLoading={updateTransaction.isPending}
												disabled={updateTransaction.isPending}
											>
												save
											</Button>
										</>
									}
								/>
							</div>
						</motion.div>
					)}
				</AnimatePresence>

				<div className="px-3 space-y-2">
					<div className="border-gray-a4 border p-2 text-xs space-y-2">
						<div className="flex items-center justify-between gap-2">
							<p className="text-gray-11">flows</p>
							{tx.amount > 0 ? (
								<p className="text-gray-10">
									available {f.amount(txAvailable, tx.currency)}
								</p>
							) : (
								<p className="text-gray-10">
									covered {f.amount(allocationCovered, tx.currency)} /{" "}
									{f.amount(Math.abs(tx.amount), tx.currency)}
									{txOverfunded > 0
										? `, over ${f.amount(txOverfunded, tx.currency)}`
										: txRemaining > 0
											? `, left ${f.amount(txRemaining, tx.currency)}`
											: ""}
								</p>
							)}
						</div>
						{ownTransferMoved > 0 && (
							<p className="text-gray-10">
								own transfer moved {f.amount(ownTransferMoved, tx.currency)}
							</p>
						)}
						<div className="grid grid-cols-2 gap-1">
							<Select
								size="sm"
								value={flowKind}
								onChange={(e) =>
									setFlowKind(e.currentTarget.value as TransactionFlowKind)
								}
							>
								<option value="allocation">allocation</option>
								<option value="own_transfer">own transfer</option>
								<option value="refund">refund</option>
							</Select>
							<input
								type="number"
								step="0.01"
								min="0"
								placeholder="amount"
								value={flowAmountInput}
								onChange={(e) => setFlowAmountInput(e.currentTarget.value)}
								className="focus border-gray-6 bg-gray-1 border px-2 h-8 text-sm min-w-0"
							/>
						</div>
						<div className="flex gap-1">
							<input
								type="text"
								placeholder="paste target tx id..."
								value={flowTargetInput}
								onChange={(e) => setFlowTargetInput(e.currentTarget.value)}
								className="focus border-gray-6 bg-gray-1 border px-2 h-8 text-sm flex-1 min-w-0"
							/>
							<Button
								size="sm"
								onClick={handleCreateFlow}
								disabled={!canCreateFlow || createFlowMutation.isPending}
							>
								create
							</Button>
						</div>
						{targetTxId && targetTxQuery.isLoading && (
							<p className="text-gray-10">loading target...</p>
						)}
						{targetTxId && targetTx && (
							<p className="text-gray-10 truncate">
								target: {targetTx.counter_party} ·{" "}
								{f.amount(targetTx.amount, targetTx.currency)}
								{flowDirection
									? ` · ${flowDirection.from_transaction_id === txId ? "from this" : "to this"}`
									: " · incompatible signs"}
							</p>
						)}
						{suggestedFlowAmount > 0 && (
							<button
								type="button"
								className="text-xs text-gray-10 hover:text-gray-12 underline"
								onClick={() => setFlowAmountInput(String(suggestedFlowAmount))}
							>
								use suggested {f.amount(suggestedFlowAmount, tx.currency)}
							</button>
						)}
						{targetTx && targetTx.currency !== tx.currency && (
							<p className="text-red-11">target currency must match</p>
						)}
					</div>

					{linkSuggestionsQuery.data && linkSuggestionsQuery.data.length > 0 && (
						<div className="border-gray-a4 border p-2 text-xs space-y-2">
							<p className="text-gray-11">possible links</p>
							<ul className="space-y-2">
								{linkSuggestionsQuery.data.map((suggestion) => {
									const candidates = suggestion.transactions.filter(
										(item) => item.id !== suggestion.primary_transaction_id,
									);
									if (candidates.length === 0) return null;
									return (
										<li key={suggestion.id} className="space-y-1">
											<div className="flex items-start justify-between gap-2">
												<div className="min-w-0">
													<p className="truncate">{suggestion.reason}</p>
													<p className="text-gray-10">
														{candidates
															.map(
																(candidate) =>
																	`${candidate.counter_party} ${f.amount(candidate.amount, candidate.currency)}`,
															)
															.join(" · ")}
													</p>
												</div>
												<div className="flex shrink-0 gap-1">
													<Button
														size="sm"
														onClick={() =>
															acceptLinkSuggestion(suggestion.suggested_flows)
														}
														disabled={createFlowMutation.isPending}
													>
														link
													</Button>
													<Button
														size="sm"
														variant="ghost"
														onClick={() =>
															dismissLinkSuggestionMutation.mutate({
																kind: suggestion.kind,
																primaryTransactionId:
																	suggestion.primary_transaction_id,
																candidateIds: candidates.map(
																	(candidate) => candidate.id,
																),
															})
														}
														disabled={dismissLinkSuggestionMutation.isPending}
													>
														dismiss
													</Button>
												</div>
											</div>
											<p className="text-gray-10">
												{suggestion.evidence.join(", ")}
											</p>
										</li>
									);
								})}
							</ul>
						</div>
					)}

					{flowsQuery.data && flowsQuery.data.length > 0 && (
						<ul className="text-xs space-y-1">
							{flowsQuery.data.map((flow) => {
								return (
									<li
										key={flow.id}
										className="flex items-start justify-between gap-2"
									>
										<span className="truncate">
											{flow.direction === "incoming" ? "from" : "to"}{" "}
											{flow.other_counter_party}
											<span className="text-gray-10"> · {flow.kind}</span>
										</span>
										<div className="text-right shrink-0">
											<span className="text-gray-10">
												{f.amount(flow.amount, flow.currency)}
											</span>
										</div>
										<button
											type="button"
											className="text-gray-10 hover:text-red-11 shrink-0"
											onClick={() =>
												deleteFlowMutation.mutate({ flowId: flow.id })
											}
										>
											delete
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</div>
		</SelectedTx>
	);
}
