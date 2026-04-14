import { useSearchParams } from "wouter";
import { useI18n } from "../../providers";
import {
	useTransactionQuery,
	useTransactionsQuery,
	useUpdateTransactionMutation,
	useBulkSetCategoryMutation,
	type TransactionRow,
} from "../../lib/queries/transactions";
import { useCategoriesQuery } from "../../lib/queries/categories";
import { Empty } from "../../components/empty";
import { Pagination, buildPaginatedHref } from "../../components/pagination";
import { Fragment, useRef, useState, type Ref } from "react";
import { Button } from "../../components/button";
import { Select } from "../../components/select";
import { TransactionForm } from "../../components/transaction-form";
import { AnimatePresence, motion } from "framer-motion";
import { SelectedTx } from "../../components/selected-tx";

export function TransactionsPage() {
	const [searchParams] = useSearchParams();

	const left = searchParams.get("left");
	const right = searchParams.get("right");
	const q = searchParams.get("q");

	const transactionsQuery = useTransactionsQuery({
		cursor: { left, right },
		search: q,
	});

	const { f } = useI18n();

	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [openTxIds, setOpenTxIds] = useState<Array<string>>([]);
	const scrolledForCursor = useRef<string | null>(null);

	function toggleSelect(txId: string) {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(txId)) next.delete(txId);
			else next.add(txId);
			return next;
		});
	}

	function openTx(txId: string) {
		setOpenTxIds((p) => [...p, txId]);
	}

	function closeTx(txId: string) {
		setOpenTxIds((p) => p.filter((id) => id !== txId));
	}

	let currentDay: string | null = null;

	return (
		<>
			<div className="w-full max-w-[35rem] mx-auto pt-14 pb-114">
				<h1 className="font-medium text-2xl font-cool">transactions</h1>

				<ul className="mt-4">
					{transactionsQuery.data?.transactions.map((tx, i) => {
						const date = new Date(tx.date);
						const day = f.weekdayShortDate.format(date);
						const dayChanged = day !== currentDay;
						currentDay = day;

						const isSelected = selectedIds.has(tx.id);

						return (
							<Fragment key={tx.id}>
								{dayChanged && (
									<div className="sticky top-10 bg-gray-3 text-xs font-medium py-1.5 px-3 scroll-mt-10">
										{currentDay}
									</div>
								)}

								<TxRow
									tx={tx}
									selected={isSelected}
									selecting={selectedIds.size > 0}
									onSelect={() => toggleSelect(tx.id)}
									onClick={() => openTx(tx.id)}
									ref={(elem) => {
										const cursorKey = left ?? right;
										if (
											!elem ||
											i !== 0 ||
											!cursorKey ||
											scrolledForCursor.current === cursorKey
										)
											return;
										scrolledForCursor.current = cursorKey;
										elem.scrollIntoView({ block: "start" });
									}}
								/>
							</Fragment>
						);
					})}
				</ul>

				{!transactionsQuery.data?.transactions?.length && (
					<Empty>
						{(searchParams.q as string) ? "no results" : "no transactions yet"}
					</Empty>
				)}
			</div>

			<div
				className={
					"fixed right-0 left-0 max-w-[35rem] mx-auto" +
					(selectedIds.size > 0
						? " bottom-22 sm:bottom-12"
						: " bottom-10 sm:bottom-0")
				}
			>
				<div className="flex justify-end pb-4">
					<Pagination
						prevHref={buildPaginatedHref(
							"left",
							transactionsQuery.data?.prev_id,
							"/txs",
							{ q: q ?? undefined },
						)}
						nextHref={buildPaginatedHref(
							"right",
							transactionsQuery.data?.next_id,
							"/txs",
							{ q: q ?? undefined },
						)}
					/>
				</div>
			</div>

			{selectedIds.size > 0 && (
				<BulkEditBar
					selectedIds={selectedIds}
					onClear={() => setSelectedIds(new Set())}
				/>
			)}

			{openTxIds.map((id, index) => (
				<SelectedTxWindow
					key={id}
					txId={id}
					index={index}
					onClose={() => closeTx(id)}
				/>
			))}
		</>
	);
}

function TxRow(props: {
	tx: TransactionRow;
	selected: boolean;
	selecting: boolean;
	onSelect: () => void;
	onClick: () => void;
	ref: Ref<HTMLLIElement>;
}) {
	const { f } = useI18n();

	const isIncome = props.tx.amount > 0;

	return (
		<li ref={props.ref} className="scroll-mt-17">
			<div
				className={
					"flex items-center justify-between gap-3 hover:bg-gray-a3 px-3 py-2" +
					(props.selected ? " bg-gray-a3" : "")
				}
				onClick={() => {
					if (props.selecting) {
						props.onSelect();
					} else {
						props.onClick();
					}
				}}
				onContextMenu={(e) => {
					e.preventDefault();
					props.onSelect();
				}}
			>
				{props.selecting && (
					<input
						type="checkbox"
						checked={props.selected}
						onChange={props.onSelect}
						onClick={(e) => e.stopPropagation()}
						className="shrink-0"
					/>
				)}
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<span className="truncate">{props.tx.counter_party}</span>
					</div>
					<div className="mt-0.5 flex gap-3 text-xs">
						{props.tx.category_name && <span>{props.tx.category_name}</span>}
						<span className="text-gray-11">{props.tx.account_name}</span>
					</div>
				</div>
				<div>
					<span
						className={`shrink-0 text-sm ${isIncome ? "text-green-11" : ""}`}
					>
						{f.amount.format(props.tx.amount)}
					</span>
				</div>
			</div>
		</li>
	);
}

function SelectedTxWindow({
	txId,
	index,
	onClose,
}: {
	txId: string;
	index: number;
	onClose: () => void;
}) {
	const { f } = useI18n();
	const [editing, setEditing] = useState(false);
	const txQuery = useTransactionQuery(txId);
	const updateTransaction = useUpdateTransactionMutation();

	if (!txQuery.data) {
		return;
	}
	const tx = txQuery.data;

	const isIncome = tx.amount > 0;
	const stackOffset = { x: 0, y: (index + 1) * 72 };

	return (
		<SelectedTx
			id={txId}
			label={`Transaction: ${tx.counter_party}, ${f.amount.format(tx.amount)}`}
			onClose={onClose}
			initialOffset={stackOffset}
		>
			<div className="space-y-1 px-3 pt-3">
				<h2 className="font-medium">{tx.counter_party}</h2>
				<p className={`text-sm ${isIncome ? "text-green-11" : ""}`}>
					{f.amount.format(tx.amount)}
				</p>
				<p className="text-xs">{f.weekdayLongDate.format(new Date(tx.date))}</p>
			</div>

			<div className="my-3 space-y-2">
				<button
					type="button"
					onClick={() => setEditing(!editing)}
					className="text-sm text-gray-11 hover:text-gray-12 px-3"
				>
					{editing ? "hide edit" : "edit"}
				</button>

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
										counter_party: tx.counter_party,
										additional: tx.additional ?? undefined,
										notes: tx.notes ?? undefined,
										category_id: tx.category_id ?? undefined,
										account_id: tx.account_id,
									}}
									onSubmit={async (values) => {
										await updateTransaction.mutateAsync({ txId, tx: values });
										setEditing(false);
									}}
									actions={
										<>
											<Button
												type="button"
												variant="ghost"
												onClick={() => setEditing(false)}
											>
												cancel
											</Button>
											<Button type="submit">save</Button>
										</>
									}
								/>
							</div>
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</SelectedTx>
	);
}

function BulkEditBar({
	selectedIds,
	onClear,
}: {
	selectedIds: Set<string>;
	onClear: () => void;
}) {
	const categories = useCategoriesQuery();
	const bulkSetCategory = useBulkSetCategoryMutation();
	const [categoryId, setCategoryId] = useState("");

	async function handleApply() {
		if (!categoryId) return;
		await bulkSetCategory.mutateAsync({
			txIds: [...selectedIds],
			categoryId: categoryId === "__none__" ? null : categoryId,
		});
		onClear();
	}

	return (
		<div className="fixed bottom-10 left-0 right-0 sm:bottom-0 z-50">
			<div className="mx-auto max-w-[35rem] border border-gray-a4 bg-gray-2 px-4 py-3 shadow-lg flex items-center gap-3">
				<span className="text-sm shrink-0">{selectedIds.size} selected</span>

				<Select
					size="sm"
					className="flex-1 min-w-0"
					value={categoryId}
					onChange={(e) => setCategoryId(e.currentTarget.value)}
				>
					<option value="">set category...</option>
					<option value="__none__">-- no category --</option>
					{categories.data?.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name}
						</option>
					))}
				</Select>

				<Button
					size="sm"
					onClick={handleApply}
					disabled={!categoryId || bulkSetCategory.isPending}
				>
					apply
				</Button>
				<Button size="sm" variant="ghost" onClick={onClear}>
					cancel
				</Button>
			</div>
		</div>
	);
}
