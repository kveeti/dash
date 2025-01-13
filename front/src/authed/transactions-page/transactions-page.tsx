import { ArrowLeftIcon, ArrowRightIcon, MixerHorizontalIcon } from "@radix-ui/react-icons";
import { format } from "date-fns";
import { useState } from "react";
import { useLocation, useSearch } from "wouter";

import {
	useLinkTransactions,
	useTransactions,
	useUpdateTransaction,
} from "../../lib/api/transactions";
import { errorToast } from "../../lib/error-toast";
import { formatCurrency } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Link } from "../../ui/link";
import {
	AmountAndCurrencyField,
	CategoryField,
	DateField,
} from "../new-transaction-page/new-transaction-fields";
import c from "./transactions-page.module.css";

type Transaction = NonNullable<ReturnType<typeof useTransactions>["data"]>["transactions"][number];

const shortDateFormatter = Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
});

const longDateFormatter = Intl.DateTimeFormat(undefined, {
	month: "numeric",
	day: "numeric",
	year: "2-digit",
});

export default function TransactionsPage() {
	const thisYear = new Date().getFullYear();
	const search = useSearch();
	const searchParams = new URLSearchParams(search);

	const q = trpc.v1.transactions.query.useQuery({});
	const linking = useTransactionLinking();

	const nextId = q.data?.next_id;
	const prevId = q.data?.prev_id;

	let lastDate = "";

	const [selectedTxId, setSelectedTxId] = useState<Transaction | null>(null);
	const selectedTx = q.data?.transactions.find((t) => t.id === selectedTxId?.id);

	function onTransactionClick(tx: Transaction) {
		if (selectedTxId?.id === tx.id) {
			setSelectedTxId(null);
			return;
		}

		setSelectedTxId(tx);
	}

	return (
		<div className="w-full max-w-sm">
			<div className="sticky top-0 bg-gray-1 p-1 flex gap-1">
				<Search currentSearchParams={searchParams} />

				<Button>
					<MixerHorizontalIcon />
				</Button>
			</div>

			{q.isPending ? (
				"loading"
			) : q.isError ? (
				"error"
			) : !q.data.transactions.length ? (
				<div className="flex w-full flex-col gap-2 p-4">
					<p className="text-gray-11">no transactions yet</p>
					<Link href="/transactions/new">add one</Link>
				</div>
			) : (
				<ul className="grid grid-cols-[max-content_1fr_auto] items-center">
					{q.data.transactions.map((t) => {
						const asDate = new Date(t.date);
						const year = asDate.getFullYear();
						const showYear = year !== thisYear;

						const date = showYear
							? longDateFormatter.format(asDate)
							: shortDateFormatter.format(asDate);

						const showDate = date !== lastDate;
						lastDate = date;

						const isPositive = t.amount > 0;

						return (
							<li
								key={t.id}
								data-id={t.id}
								className="col-[span_3] grid w-full grid-cols-subgrid overflow-hidden text-sm"
							>
								<div className="col-[span_3] grid w-full grid-cols-subgrid overflow-hidden text-sm">
									<span
										className={cn(
											"border-t-gray-3 col-[1] flex h-full items-center border-t px-2 py-3 text-sm",
											!showDate && "invisible"
										)}
									>
										{date}
									</span>

									<span className="border-t-gray-3 col-[2] flex items-center border-t px-3 py-3">
										<span className="truncate">{t.counter_party}</span>
									</span>

									<div
										className={cn(
											"border-t-gray-3 col-[3] border-t px-2 py-3 text-right tabular-nums",
											isPositive && "text-green-10"
										)}
									>
										{t.amount.toFixed(2)}
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

function TransactionDetails({
	tx,
}: {
	tx: {
		id: string;
		counter_party: string;
		amount: number;
		currency: string;
		date: Date;
		formattedAmount: string;
		category?: { name: string };
		additional: string;
	};
}) {
	const mutation = useUpdateTransaction(tx.id);

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (mutation.isPending) return;

		const formData = new FormData(event.currentTarget);

		// convert date to ISO string
		const date = new Date(formData.get("date") as string).toISOString();
		formData.set("date", date);

		mutation
			.mutateAsync({
				date,
				amount: Number(formData.get("amount")),
				currency: formData.get("currency") as string,
				counter_party: formData.get("counter_party") as string,
				additional: formData.get("additional") as string,
				category_name: formData.get("category_name") as string,
			})
			.catch(errorToast("error updating transaction"));
	}

	return (
		<div className={c.txDetails}>
			<h2>{tx.counter_party}</h2>

			<h3>{tx.formattedAmount}</h3>

			<h4>
				{Intl.DateTimeFormat(undefined, {
					month: "short",
					day: "numeric",
					year: "numeric",
					hour: "numeric",
					minute: "numeric",
				}).format(tx.date)}
			</h4>

			<form onSubmit={onSubmit}>
				<Input name="counter_party" label="counter party" defaultValue={tx.counter_party} />

				<AmountAndCurrencyField defaultValue={tx.amount} defaultCurrency={tx.currency} />

				<DateField defaultValue={tx.date} />

				<CategoryField defaultValue={tx.category?.name} />

				<Input name="additional" label="additional" defaultValue={tx.additional} />

				<div className={c.buttons}>
					<Button type="submit" isLoading={mutation.isPending}>
						save
					</Button>
				</div>
			</form>
		</div>
	);
}

function Search({ currentSearchParams }: { currentSearchParams: URLSearchParams }) {
	const [location, setLocation] = useLocation();

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();

		const formData = new FormData(e.currentTarget);

		const query = formData.get("query") as string;
		currentSearchParams.set("query", query);

		setLocation(location + "?" + currentSearchParams.toString());
	}

	return (
		<form onSubmit={onSubmit} className="w-full">
			<label htmlFor="query" className="sr-only">
				search
			</label>
			<Input
				placeholder="search transactions..."
				defaultValue={currentSearchParams.get("query") || ""}
				name="query"
				id="query"
			/>
		</form>
	);
}

// function Loading() {
// 	return (
// 		<div className={c.loadingList} aria-hidden="true">
// 			{Array.from({ length: 50 }).map((_, i) => (
// 				<div key={i}>0</div>
// 			))}
// 		</div>
// 	);
// }

function Pagination({
	nextId,
	prevId,
	currentSearchParams,
}: {
	nextId?: string | null;
	prevId?: string | null;
	currentSearchParams: URLSearchParams;
}) {
	const prevParams = new URLSearchParams(currentSearchParams);
	const nextParams = new URLSearchParams(currentSearchParams);

	if (prevId) {
		prevParams.set("before", prevId);
		prevParams.delete("after");
	}

	if (nextId) {
		nextParams.set("after", nextId);
		nextParams.delete("before");
	}

	return (
		<div className={c.pg}>
			<div className={c.pgLink}>
				<Link href={prevId && "?" + prevParams.toString()}>
					<ArrowLeftIcon aria-hidden="true" />
					<span className="sr-only">previous page</span>
				</Link>
			</div>

			<div className={c.pgLink}>
				<Link href={nextId && "?" + nextParams.toString()}>
					<ArrowRightIcon aria-hidden="true" />
					<span className="sr-only">next page</span>
				</Link>
			</div>
		</div>
	);
}

function LinkTransactions({
	transactionA,
	transactionB,
	onTransactionClick,
}: {
	transactionA: Transaction | null;
	transactionB: Transaction | null;
	onTransactionClick: (transaction: Transaction) => void;
}) {
	const mutation = useLinkTransactions();

	if (!transactionA && !transactionB) return;

	function onClick() {
		if (!transactionA || !transactionB) return;

		let plus = null;
		let minus = null;

		if (transactionA.amount > 0 && transactionB.amount < 0) {
			plus = transactionA;
			minus = transactionB;
		} else if (transactionA.amount < 0 && transactionB.amount > 0) {
			plus = transactionB;
			minus = transactionA;
		}

		if (!plus || !minus) {
			return;
		}

		mutation
			.mutateAsync({
				transaction_a_id: plus.id,
				transaction_b_id: minus.id,
			})
			.catch(errorToast("error linking"));
	}

	return (
		<div className={c.linkingWrapper}>
			<div className={c.linking}>
				<div className={c.txList}>
					{transactionA && (
						<div
							className={c.tx}
							onClick={() => onTransactionClick(transactionA)}
							onKeyDown={() => onTransactionClick(transactionA)}
						>
							<span className={c.date + " " + c.alwaysVisible}>
								{format(transactionA.date, "MMM d")}
							</span>

							<span className={c.counterParty}>
								<span>{transactionA.counter_party}</span>
							</span>

							<div className={c.amount}>
								{formatCurrency(transactionA.amount, transactionA.currency)}
							</div>
						</div>
					)}
					{transactionB && (
						<div
							className={c.tx}
							onClick={() => onTransactionClick(transactionB)}
							onKeyDown={() => onTransactionClick(transactionB)}
						>
							<span className={c.date + " " + c.alwaysVisible}>
								{format(transactionB.date, "MMM d")}
							</span>

							<span className={c.counterParty}>
								<span>{transactionB.counter_party}</span>
							</span>

							<div className={c.amount}>
								{formatCurrency(transactionB.amount, transactionB.currency)}
							</div>
						</div>
					)}
				</div>

				<div className={c.buttons}>
					<p>link + and -</p>
					<Button onClick={onClick}>link</Button>
				</div>
			</div>
		</div>
	);
}

function useTransactionLinking() {
	const [transactionA, setTransactionA] = useState<Transaction | null>(null);
	const [transactionB, setTransactionB] = useState<Transaction | null>(null);

	function onTransactionClick(transaction: Transaction) {
		if (transactionA?.id === transaction.id) {
			setTransactionA(null);
			return;
		}

		if (transactionB?.id === transaction.id) {
			setTransactionB(null);
			return;
		}

		if (transactionA && transactionA.id !== transaction.id) {
			setTransactionB(transaction);
			return;
		}

		if (transactionA) {
			setTransactionB(transaction);
			return;
		}

		setTransactionA(transaction);
	}

	return { onTransactionClick, transactionA, transactionB };
}
