import { useSearchParams } from "wouter";
import { useI18n } from "../../providers";
import {
	useTransactionQuery,
	useTransactionsQuery,
	useUpdateTransactionMutation,
	type TransactionRow,
} from "../../lib/queries/transactions";
import { Empty } from "../../components/empty";
import { Pagination, buildPaginatedHref } from "../../components/pagination";
import { Fragment, useState, type Ref } from "react";
import { Button } from "../../components/button";
import { TransactionForm } from "../../components/transaction-form";
import { AnimatePresence, motion } from "framer-motion";
import { SelectedTx } from "../../components/selected-tx";

export function TransactionsPage() {
	const [searchParams] = useSearchParams();

	const left = searchParams.get("left");
	const right = searchParams.get("right");
	const isPaginating = !!left || !!right;
	const q = searchParams.get("q");

	const transactionsQuery = useTransactionsQuery({
		cursor: { left, right },
		search: q,
	});

	const { f } = useI18n();

	const [selectedIds, setSelectedIds] = useState<Array<string>>([]);

	function selectTx(txId: string) {
		setSelectedIds((p) => [...p, txId]);
	}

	function deselectTx(txId: string) {
		setSelectedIds((p) => p.filter((id) => id !== txId));
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

						return (
							<Fragment key={tx.id}>
								{dayChanged && (
									<div className="sticky top-10 bg-gray-3 text-xs font-medium py-1.5 px-3 scroll-mt-10">
										{currentDay}
									</div>
								)}

								<TxRow
									tx={tx}
									onClick={() => selectTx(tx.id)}
									ref={(elem) => {
										if (!elem || i !== 0 || !isPaginating) return;
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

			<div className="fixed bottom-10 right-0 left-0 max-w-[35rem] mx-auto sm:bottom-0">
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

			{selectedIds.map((id, index) => (
				<SelectedTxWindow
					key={id}
					txId={id}
					index={index}
					onClose={() => deselectTx(id)}
				/>
			))}
		</>
	);
}

function TxRow(props: {
	tx: TransactionRow;
	onClick: () => void;
	ref: Ref<HTMLLIElement>;
}) {
	const { f } = useI18n();

	const isIncome = props.tx.amount > 0;

	return (
		<li ref={props.ref} className="scroll-mt-17">
			<div
				className="flex items-center justify-between gap-3 hover:bg-gray-a3 px-3 py-2"
				onClick={() => props.onClick()}
			>
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
