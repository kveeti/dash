import { useRef, useState, type FormEvent } from "react";
import { useI18n } from "../providers";
import type {
	TransactionDetails,
	TransactionFlow,
	TransactionFlowKind,
	TransactionRow,
} from "../lib/queries/transactions";
import {
	useCreateTransactionFlowMutation,
	useTransactionFlowsQuery,
	useTransactionQuery,
	useTransactionsQuery,
} from "../lib/queries/transactions";
import { Button } from "./button";
import { Combobox } from "./combobox";
import { IconChevronsUpDown } from "./icons/chevrons-up-down";
import { Select } from "./select";
import {
	getAvailableFlowAmount,
	inferFlowDirection,
} from "./selected-tx-flow-logic";

type FlowTargetItem = Pick<
	TransactionRow,
	"id" | "date" | "counter_party" | "amount" | "currency" | "account_name"
>;

export function SelectedTxCreateFlowForm({
	flows,
	tx,
	txId,
}: {
	flows: TransactionFlow[] | undefined;
	tx: TransactionDetails;
	txId: string;
}) {
	const { f } = useI18n();
	const [flowTargetSearch, setFlowTargetSearch] = useState("");
	const [flowTarget, setFlowTarget] = useState<FlowTargetItem | null>(null);
	const [flowKind, setFlowKind] = useState<TransactionFlowKind>("allocation");
	const linkFormRef = useRef<HTMLFormElement>(null);
	const targetTxId = flowTarget?.id ?? "";
	const targetSearchQuery = useTransactionsQuery({
		search: flowTargetSearch.trim() || undefined,
	});
	const targetTxQuery = useTransactionQuery(
		targetTxId && targetTxId !== txId ? targetTxId : undefined,
	);
	const targetFlowsQuery = useTransactionFlowsQuery(
		targetTxId && targetTxId !== txId ? targetTxId : undefined,
	);
	const createFlowMutation = useCreateTransactionFlowMutation();
	const targetTx = targetTxQuery.data;
	const flowTargetItems =
		targetSearchQuery.data?.transactions.filter((item) => item.id !== txId) ??
		[];
	const formatTargetDate = (date: Date) => f.longDate.format(date);
	const flowDirection = targetTx
		? inferFlowDirection({ selected: tx, target: targetTx, kind: flowKind })
		: null;
	const exchangeFromTx =
		flowDirection && targetTx
			? flowDirection.from_transaction_id === tx.id
				? tx
				: targetTx
			: null;
	const exchangeToTx =
		flowDirection && targetTx
			? flowDirection.to_transaction_id === tx.id
				? tx
				: targetTx
			: null;
	const canCreateFlow =
		!!flowDirection &&
		!!targetTx &&
		(flowKind === "currency_exchange"
			? tx.currency !== targetTx.currency
			: tx.currency === targetTx.currency);
	const suggestedFlowAmount = (() => {
		if (!targetTx || !flowDirection) return 0;
		if (flowKind !== "currency_exchange" && tx.currency !== targetTx.currency) {
			return 0;
		}
		if (flowKind === "currency_exchange") {
			if (!exchangeFromTx) return 0;
			return Math.max(0, Math.round(Math.abs(exchangeFromTx.amount) * 100) / 100);
		}
		const selectedAvailable = getAvailableFlowAmount(tx, flows, flowKind);
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
	const suggestedExchangeToAmount =
		flowKind === "currency_exchange" && exchangeToTx
			? Math.max(0, Math.round(Math.abs(exchangeToTx.amount) * 100) / 100)
			: 0;

	async function handleCreateFlow(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (createFlowMutation.isPending) return;
		const target = targetTxQuery.data;
		if (!target || target.id === txId) return;
		const formData = new FormData(e.currentTarget);
		const kind = formData.get("kind") as TransactionFlowKind;
		const direction = inferFlowDirection({ selected: tx, target, kind });
		if (!direction) return;
		const amount = Number(String(formData.get("amount") ?? "").replace(",", "."));
		if (!Number.isFinite(amount) || amount <= 0) return;
		const fromTx = direction.from_transaction_id === tx.id ? tx : target;
		const toTx = direction.to_transaction_id === tx.id ? tx : target;
		const toAmount = Number(String(formData.get("to_amount") ?? "").replace(",", "."));
		if (
			kind === "currency_exchange" &&
			(!Number.isFinite(toAmount) || toAmount <= 0)
		) {
			return;
		}
		await createFlowMutation.mutateAsync({
			...direction,
			amount,
			currency: fromTx.currency,
			to_amount: kind === "currency_exchange" ? toAmount : undefined,
			to_currency: kind === "currency_exchange" ? toTx.currency : undefined,
			kind,
		});
		setFlowTarget(null);
		setFlowTargetSearch("");
		e.currentTarget.reset();
	}

	function useSuggestedAmount() {
		const form = linkFormRef.current;
		const amountInput = form?.elements.namedItem("amount");
		if (amountInput instanceof HTMLInputElement) {
			amountInput.value = String(suggestedFlowAmount);
		}
		if (
			flowKind === "currency_exchange" &&
			suggestedExchangeToAmount > 0
		) {
			const toAmountInput = form?.elements.namedItem("to_amount");
			if (toAmountInput instanceof HTMLInputElement) {
				toAmountInput.value = String(suggestedExchangeToAmount);
			}
		}
	}

	return (
		<>
			<form
				ref={linkFormRef}
				onSubmit={handleCreateFlow}
				className="space-y-2"
			>
				<div className="grid grid-cols-2 gap-1">
					<Select
						name="kind"
						size="sm"
						value={flowKind}
						onChange={(e) =>
							setFlowKind(e.currentTarget.value as TransactionFlowKind)
						}
					>
						<option value="allocation">allocation</option>
						<option value="own_transfer">own transfer</option>
						<option value="refund">refund</option>
						<option value="currency_exchange">currency exchange</option>
					</Select>
					<input
						name="amount"
						type="number"
						step="0.01"
						min="0"
						placeholder={
							flowKind === "currency_exchange"
								? exchangeFromTx
									? `${exchangeFromTx.currency} amount`
									: "from amount"
								: "amount"
						}
						className="focus border-gray-6 bg-gray-1 border px-2 h-8 text-sm min-w-0"
					/>
				</div>
				{flowKind === "currency_exchange" && (
					<input
						name="to_amount"
						type="number"
						step="0.01"
						min="0"
						placeholder={
							exchangeToTx ? `${exchangeToTx.currency} amount` : "to amount"
						}
						className="focus border-gray-6 bg-gray-1 border px-2 h-8 text-sm min-w-0 w-full"
					/>
				)}
				<div className="flex gap-1">
					<Combobox.Root
						items={flowTargetItems}
						value={flowTarget}
						onValueChange={setFlowTarget}
						onInputValueChange={setFlowTargetSearch}
						itemToStringLabel={(item) =>
							`${item.counter_party} ${item.account_name} ${formatTargetDate(item.date)} ${f.amount(item.amount, item.currency)}`
						}
						isItemEqualToValue={(item, selected) => item.id === selected.id}
						autoHighlight
					>
						<Combobox.Trigger<FlowTargetItem, FlowTargetItem | null>
							className="focus border-gray-6 bg-gray-1 data-[popup-open]:bg-gray-a2 data-[disabled]:opacity-60 flex h-8 flex-1 min-w-0 items-center justify-between gap-2 overflow-hidden border pl-2.5 pr-2 text-sm"
						>
							{({ selectedValue }) => (
								<>
									<span className="truncate text-gray-12">
										{selectedValue ? (
											selectedValue.counter_party
										) : (
											<span className="text-gray-10">
												target transaction
											</span>
										)}
									</span>
									<Combobox.Icon className="text-gray-10 flex shrink-0">
										<IconChevronsUpDown />
									</Combobox.Icon>
								</>
							)}
						</Combobox.Trigger>
						<Combobox.Content
							searchPlaceholder="search transactions..."
							empty="no transactions found"
							size="sm"
						>
							<Combobox.List<FlowTargetItem>>
								{(item) => (
									<Combobox.Item key={item.id} value={item} size="sm">
										<div className="flex min-w-0 flex-1 items-center justify-between gap-2">
											<div className="min-w-0">
												<p className="truncate">{item.counter_party}</p>
												<p className="truncate text-xs text-gray-10">
													{formatTargetDate(item.date)} · {item.account_name}
												</p>
											</div>
											<span className="shrink-0 text-xs text-gray-10">
												{f.amount(item.amount, item.currency)}
											</span>
										</div>
									</Combobox.Item>
								)}
							</Combobox.List>
						</Combobox.Content>
					</Combobox.Root>
					<Button
						type="submit"
						size="sm"
						disabled={!canCreateFlow}
					>
						create
					</Button>
				</div>
			</form>
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
					onClick={useSuggestedAmount}
				>
					use suggested{" "}
					{flowKind === "currency_exchange" && exchangeFromTx && exchangeToTx
						? `${f.amount(suggestedFlowAmount, exchangeFromTx.currency)} -> ${f.amount(suggestedExchangeToAmount, exchangeToTx.currency)}`
						: f.amount(suggestedFlowAmount, tx.currency)}
				</button>
			)}
			{targetTx && flowKind !== "currency_exchange" && targetTx.currency !== tx.currency && (
				<p className="text-red-11">target currency must match</p>
			)}
			{targetTx && flowKind === "currency_exchange" && targetTx.currency === tx.currency && (
				<p className="text-red-11">exchange target currency must differ</p>
			)}
		</>
	);
}
