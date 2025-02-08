import {
	ArrowLeftIcon,
	ArrowRightIcon,
	Cross1Icon,
	MixerHorizontalIcon,
} from "@radix-ui/react-icons";
import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";

import type { TransactionWithLinks } from "../../../../back/src/data/transactions";
import { errorToast } from "../../lib/error-toast";
import { useMe } from "../../lib/me";
import { trpc } from "../../lib/trpc";
import { Button } from "../../ui/button";
import * as Dialog from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Link } from "../../ui/link";
import * as Sidebar from "../../ui/sidebar";
import { Spinner } from "../../ui/spinner";
import {
	AmountAndCurrencyField,
	CategoryField,
	DateField,
} from "../new-transaction-page/new-transaction-fields";

export default function TransactionsPage() {
	const { shortDateFormatter, longDateFormatter, amountFormatter } = useFormatters();

	const thisYear = new Date().getFullYear();
	const search = useSearch();
	const searchParams = new URLSearchParams(search);

	const right = searchParams.get("right") ?? undefined;
	const left = searchParams.get("left") ?? undefined;
	const query = searchParams.get("query") ?? undefined;

	const q = trpc.v1.transactions.query.useQuery({
		left,
		right,
		query,
	});

	const leftId = q.data?.prev_id;
	const rightId = q.data?.next_id;

	const [selectedTxId, setSelectedTxId] = useState<TransactionWithLinks | null>(null);
	const selectedTx = q.data?.transactions.find((t) => t.id === selectedTxId?.id);

	function onTxClick(this: TransactionWithLinks) {
		setSelectedTxId((p) => (p?.id === this.id ? null : this));
	}

	let lastDate = "";
	return (
		<div className="w-full max-w-md">
			{/* desktop */}
			<div className="bg-gray-1 border-b-gray-4 order-b sticky top-10 hidden pt-2 sm:block">
				<div className="flex gap-1">
					<Search currentSearchParams={searchParams} />

					<Button>
						<MixerHorizontalIcon />
					</Button>
				</div>

				<div className="flex items-center justify-between py-2">
					{q.isPending && <Spinner />}

					<Pagination
						className="ml-auto"
						currentSearchParams={searchParams}
						leftId={leftId}
						rightId={rightId}
					/>
				</div>
			</div>

			{/* mobile */}
			<div className="bg-gray-1 border-t-gray-5 pwa:bottom-20 fixed right-0 bottom-10 left-0 block border-t px-1 pb-2 sm:hidden">
				<div className="flex items-center justify-between py-2">
					{q.isPending && <Spinner />}

					<Pagination
						className="ml-auto"
						currentSearchParams={searchParams}
						leftId={leftId}
						rightId={rightId}
					/>
				</div>

				<div className="flex gap-1">
					<Search currentSearchParams={searchParams} />

					<Button>
						<MixerHorizontalIcon />
					</Button>
				</div>
			</div>

			{q.isPending ? (
				Loading
			) : q.isError ? (
				"error"
			) : !q.data.transactions.length ? (
				<div className="flex w-full flex-col gap-2 p-4">
					<p className="text-gray-11">no transactions yet</p>
					<Link variant="text" href="/transactions/new">
						add one
					</Link>
				</div>
			) : (
				<>
					{selectedTx && (
						<div
							className="fixed top-0 right-0 max-h-full w-full max-w-[28rem] overflow-y-auto pb-10 sm:top-14 sm:right-4"
							key={selectedTx.id}
						>
							<SelectedTx unselect={() => setSelectedTxId(null)} tx={selectedTx} />
						</div>
					)}

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
									onClick={onTxClick.bind(t)}
								>
									<div className="col-[span_3] grid w-full grid-cols-subgrid overflow-hidden text-sm">
										<span
											className={
												"border-t-gray-3 col-[1] flex h-full items-center border-t px-2 py-3 text-sm" +
												(!showDate ? " invisible" : "")
											}
										>
											{date}
										</span>

										<span className="border-t-gray-3 col-[2] flex items-center truncate border-t p-3">
											<span className="truncate">{t.counter_party}</span>
										</span>

										<div
											className={
												"border-t-gray-3 col-[3] border-t px-2 py-3 text-right tabular-nums" +
												(isPositive ? " text-green-10" : "")
											}
										>
											{amountFormatter.format(t.amount)}
										</div>
									</div>
								</li>
							);
						})}
					</ul>
				</>
			)}
		</div>
	);
}

function SelectedTx({ tx, unselect }: { tx: TransactionWithLinks; unselect: () => void }) {
	const { sidebarDateFormatter, amountFormatter } = useFormatters();

	const t = trpc.useUtils();
	const mutation = trpc.v1.transactions.edit.useMutation({
		onSuccess: () => {
			t.v1.transactions.query.invalidate();
		},
	});

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (mutation.isPending) return;

		const formData = new FormData(event.currentTarget);

		mutation
			.mutateAsync({
				id: tx.id,
				date: new Date(formData.get("date") as string),
				amount: Number(formData.get("amount")),
				currency: formData.get("currency") as string,
				counter_party: formData.get("counter_party") as string,
				additional: formData.get("additional") as string,
				category_name: formData.get("category_name") as string | null,
			})
			.catch(errorToast("error updating transaction"));
	}

	return (
		<Sidebar.Root modal={false} defaultOpen onOpenChange={unselect}>
			<Sidebar.Content
				className="relative space-y-2"
				onInteractOutside={(e) => e.preventDefault()}
			>
				<Sidebar.Title>{tx.counter_party}</Sidebar.Title>

				<Sidebar.Close className="!absolute top-1 right-1" asChild>
					<Button size="icon" variant="ghost">
						<Cross1Icon />
					</Button>
				</Sidebar.Close>

				<p className="text-base">{amountFormatter.format(tx.amount)}</p>

				<p>{sidebarDateFormatter.format(tx.date)}</p>

				<p className="text-gray-11 break-words">{tx.additional}</p>

				<div className="mt-3 flex items-start gap-2">
					<details className="w-full">
						<summary className="border-gray-5 focus h-10 border px-3 py-2">
							<span className="leading-none select-none">edit</span>
						</summary>

						<form onSubmit={onSubmit} className="space-y-4 pt-2">
							<Input
								name="counter_party"
								label="counter party"
								defaultValue={tx.counter_party}
							/>

							<AmountAndCurrencyField
								defaultValue={tx.amount}
								defaultCurrency={tx.currency}
							/>

							<DateField defaultValue={tx.date} />

							<CategoryField defaultValue={tx.category?.name} />

							<Input
								name="additional"
								label="additional"
								defaultValue={tx.additional}
							/>

							<div className="flex justify-between gap-2">
								<DeleteTransaction id={tx.id} counterParty={tx.counter_party} />

								<Button type="submit" isLoading={mutation.isPending}>
									save
								</Button>
							</div>
						</form>
					</details>
				</div>
			</Sidebar.Content>
		</Sidebar.Root>
	);
}

function DeleteTransaction({ id, counterParty }: { id: string; counterParty: string }) {
	const t = trpc.useUtils();
	const mutation = trpc.v1.transactions.delete.useMutation({
		onSuccess: () => {
			t.v1.transactions.invalidate();
		},
	});

	function onConfirm() {
		if (mutation.isPending) return;

		mutation.mutateAsync({ id }).catch(errorToast("error deleting transaction"));
	}

	return (
		<Dialog.Root>
			<Dialog.Trigger>
				<Button variant="destructive">delete</Button>
			</Dialog.Trigger>

			<Dialog.Content>
				<div className="space-y-2">
					<Dialog.Title>delete transaction</Dialog.Title>
					<Dialog.Desc>delete "{counterParty}"?</Dialog.Desc>
				</div>

				<div className="mt-5 flex justify-end gap-3">
					<Dialog.Close asChild>
						<Button variant="ghost">cancel</Button>
					</Dialog.Close>
					<Button
						isLoading={mutation.isPending}
						variant="destructive"
						onClick={onConfirm}
					>
						yes, delete
					</Button>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}

function Search({ currentSearchParams }: { currentSearchParams: URLSearchParams }) {
	const [location, setLocation] = useLocation();

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();

		const formData = new FormData(e.currentTarget);

		const query = formData.get("query") as string;
		currentSearchParams.set("query", query);
		currentSearchParams.delete("right");
		currentSearchParams.delete("left");

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

function Pagination({
	rightId,
	leftId,
	currentSearchParams,
	className,
}: {
	rightId?: string | null;
	leftId?: string | null;
	currentSearchParams: URLSearchParams;
	className?: string;
}) {
	const prevParams = new URLSearchParams(currentSearchParams);
	const nextParams = new URLSearchParams(currentSearchParams);

	if (leftId) {
		prevParams.set("left", leftId);
		prevParams.delete("right");
	}

	if (rightId) {
		nextParams.set("right", rightId);
		nextParams.delete("left");
	}

	return (
		<div className={"flex gap-1" + (className ? " " + className : "")}>
			<Link
				href={leftId && "?" + prevParams.toString()}
				className="border-gray-5 flex size-8 items-center justify-center rounded-full border"
			>
				<ArrowLeftIcon aria-hidden="true" />
				<span className="sr-only">to the left</span>
			</Link>

			<Link
				href={rightId && "?" + nextParams.toString()}
				className="border-gray-5 flex size-8 items-center justify-center rounded-full border"
			>
				<ArrowRightIcon aria-hidden="true" />
				<span className="sr-only">to the right</span>
			</Link>
		</div>
	);
}

const Loading = (
	<div className="divide-gray-3 divide-y">
		{Array.from({ length: 3 }).map((_, i) => (
			<div key={i} className="p-3">
				<span className="invisible">0</span>
			</div>
		))}
	</div>
);

function useFormatters() {
	const { me } = useMe();

	const shortDateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(me?.preferences?.locale, {
				month: "short",
				day: "numeric",
			}),
		[me?.preferences?.locale]
	);

	const longDateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(me?.preferences?.locale, {
				month: "numeric",
				day: "numeric",
				year: "2-digit",
			}),
		[me?.preferences?.locale]
	);

	const sidebarDateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(me?.preferences?.locale, {
				month: "short",
				day: "numeric",
				year: "numeric",
				minute: "numeric",
				hour: "numeric",
				second: "numeric",
			}),
		[me?.preferences?.locale]
	);

	const amountFormatter = useMemo(
		() =>
			new Intl.NumberFormat(me?.preferences?.locale, {
				signDisplay: "auto",
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
				currencyDisplay: "symbol",
				style: "currency",
				currency: "EUR",
			}),
		[me?.preferences?.locale]
	);

	return { shortDateFormatter, longDateFormatter, sidebarDateFormatter, amountFormatter };
}
