import { useMemo, useState } from "react";
import { useI18n } from "../../providers";
import { Button } from "../../components/button";
import { CategoryCombobox } from "../../components/category-combobox";
import { Spinner } from "../../components/spinner";
import { useCategoryOptionsQuery } from "../../lib/queries/categories";
import {
	useBulkSetCategoryMutation,
	useTransactionsQuery,
	type TransactionRow,
} from "../../lib/queries/transactions";
import { useTransactionWindows } from "../../components/transaction-windows";
import { FastLink } from "../../components/link";

export function ReviewPage() {
	const { f } = useI18n();
	const [skipped, setSkipped] = useState<Set<string>>(new Set());
	const { openTransaction } = useTransactionWindows();

	const txQuery = useTransactionsQuery({
		search: undefined,
		filters: { uncategorized: true },
		sort: "date_desc",
	});
	const categoriesQuery = useCategoryOptionsQuery();
	const setCategory = useBulkSetCategoryMutation();

	const rows = useMemo(
		() => txQuery.data?.transactions ?? [],
		[txQuery.data?.transactions],
	);
	const queue = useMemo(
		() => rows.filter((row) => !skipped.has(row.id)),
		[rows, skipped],
	);
	const current = queue[0];
	const totalRemaining = rows.length;
	const skippedCount = skipped.size;

	const categoryItems = useMemo(
		() => [
			...(categoriesQuery.data ?? []).map((category) => ({
				id: category.id,
				value: category.id,
				label: category.name,
			})),
		],
		[categoriesQuery.data],
	);

	async function commitCategory(categoryId: string) {
		if (!current) return;
		if (!categoryId) return;
		try {
			await setCategory.mutateAsync({
				txIds: [current.id],
				categoryId,
			});
		} catch (err) {
			console.error(err);
		}
	}

	function skip() {
		if (!current) return;
		setSkipped((prev) => {
			const next = new Set(prev);
			next.add(current.id);
			return next;
		});
	}

	function resetSkipped() {
		setSkipped(new Set());
	}

	if (txQuery.isLoading) {
		return (
			<div className="flex h-[60vh] items-center justify-center">
				<Spinner />
			</div>
		);
	}

	if (!current) {
		return (
			<div className="mx-auto max-w-[640px] px-4 sm:px-6">
				<Header skippedCount={skippedCount} totalRemaining={totalRemaining} />
				<div className="surface surface-bleed mt-8 flex flex-col items-center gap-4 px-3 sm:px-4 py-16 text-center">
					<div className="size-10 rounded-full bg-gray-a3 flex items-center justify-center text-gray-12">
						✓
					</div>
					<div>
						<h2 className="text-[15px] font-medium text-gray-12">
							All caught up
						</h2>
						<p className="mt-1 text-[12px] text-gray-10">
							{skippedCount > 0
								? `You skipped ${skippedCount}. Pull them back into the queue or move on.`
								: "Nothing uncategorized in the most recent batch."}
						</p>
					</div>
					{skippedCount > 0 ? (
						<Button variant="outline" size="sm" onClick={resetSkipped}>
							Review skipped
						</Button>
					) : (
						<FastLink
							href="/txs"
							className="text-[12px] text-gray-11 hover:text-gray-12 hover:underline"
						>
							Back to transactions →
						</FastLink>
					)}
				</div>
			</div>
		);
	}

	const processed = (rows.length - queue.length) - skippedCount;

	return (
		<div className="mx-auto max-w-[640px] px-4 sm:px-6">
			<Header skippedCount={skippedCount} totalRemaining={totalRemaining} />

			<article
				key={current.id}
				className="surface surface-bleed mt-6 px-3 sm:px-4 py-6 space-y-6"
			>
				<TxIdentity tx={current} fAmount={f.amount} />

				<div className="space-y-2">
					<label className="field-label">Category</label>
					<CategoryCombobox
						creatable
						items={categoryItems}
						value=""
						onChange={(value) => {
							if (value) void commitCategory(value);
						}}
						placeholder="Type to search or create…"
					/>
					<p className="text-[11px] text-gray-10">
						Pick a category to file this transaction. It saves the moment you choose.
					</p>
				</div>

				<div className="flex items-center justify-between border-t border-gray-a3 pt-4">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => openTransaction(current.id)}
					>
						Open details
					</Button>
					<div className="flex items-center gap-2">
						{setCategory.isPending && <Spinner />}
						<Button variant="outline" size="sm" onClick={skip}>
							Skip
						</Button>
					</div>
				</div>
			</article>

			<Progress
				processed={processed}
				skipped={skippedCount}
				remaining={queue.length}
			/>
		</div>
	);
}

function Header(props: { skippedCount: number; totalRemaining: number }) {
	return (
		<div className="flex items-baseline justify-between gap-4 mt-2">
			<div>
				<h1 className="text-[15px] font-medium tracking-[-0.005em]">
					Review queue
				</h1>
				<p className="text-[12px] text-gray-10 mt-0.5">
					Triage uncategorized transactions, one at a time.
				</p>
			</div>
			<div className="text-[12px] text-gray-10 num">
				{props.totalRemaining > 0
					? `${props.totalRemaining - props.skippedCount} pending`
					: "0 pending"}
			</div>
		</div>
	);
}

function TxIdentity({
	tx,
	fAmount,
}: {
	tx: TransactionRow;
	fAmount: (amount: number, currency: string) => string;
}) {
	const signed = formatSigned(tx.amount, tx.currency, fAmount);
	const negative = tx.amount < 0;
	return (
		<div className="space-y-2">
			<div className="flex items-baseline justify-between gap-3">
				<div className="min-w-0">
					<div className="truncate text-[15px] font-medium text-gray-12">
						{tx.counter_party}
					</div>
					<div className="text-[12px] text-gray-10 mt-0.5 num">
						{tx.date.toLocaleDateString("fi-FI", {
							year: "numeric",
							month: "numeric",
							day: "numeric",
							timeZone: "UTC",
						})}{" "}
						·{" "}
						<span className="text-gray-11">{tx.account_name}</span>
					</div>
				</div>
				<div
					className={
						"num shrink-0 text-[20px] font-medium tracking-[-0.01em] " +
						(negative ? "text-gray-12" : "text-green-11")
					}
				>
					{signed}
				</div>
			</div>
			{tx.tags.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{tx.tags.map((tag) => (
						<span
							key={tag.id}
							className="rounded-sm bg-gray-a2 px-1.5 py-0.5 text-[11px] text-gray-11"
						>
							{tag.name}
						</span>
					))}
				</div>
			)}
		</div>
	);
}

function formatSigned(
	amount: number,
	currency: string,
	fAmount: (amount: number, currency: string) => string,
) {
	if (amount > 0) return `+${fAmount(amount, currency)}`;
	if (amount < 0) return `−${fAmount(Math.abs(amount), currency)}`;
	return fAmount(amount, currency);
}

function Progress({
	processed,
	skipped,
	remaining,
}: {
	processed: number;
	skipped: number;
	remaining: number;
}) {
	const total = processed + skipped + remaining;
	if (total === 0) return null;
	const procPct = (processed / total) * 100;
	const skipPct = (skipped / total) * 100;
	return (
		<div className="mt-6 space-y-2">
			<div className="relative h-1 overflow-hidden rounded-full bg-gray-a2">
				<div
					className="absolute inset-y-0 left-0 bg-gray-12"
					style={{ width: `${procPct}%` }}
				/>
				<div
					className="absolute inset-y-0 bg-gray-a5"
					style={{ left: `${procPct}%`, width: `${skipPct}%` }}
				/>
			</div>
			<div className="flex items-center gap-4 text-[11px] text-gray-10 num">
				<span>{processed} done</span>
				<span>{skipped} skipped</span>
				<span className="ml-auto">{remaining} left</span>
			</div>
		</div>
	);
}
