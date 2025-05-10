import { UseQueryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tooltip } from "radix-ui";
import { FormEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useSearchParams } from "wouter";

import { api } from "../../api";
import { paths } from "../../api_types";
import { errorToast } from "../../lib/error-toast";
import { Button } from "../../ui/button";
import * as Dialog from "../../ui/dialog";
import { IconCheck } from "../../ui/icons/check";
import { IconChevronLeft } from "../../ui/icons/chevron-left";
import { IconChevronRight } from "../../ui/icons/chevron-right";
import { IconCopy } from "../../ui/icons/copy";
import { IconCross } from "../../ui/icons/cross";
import { Input } from "../../ui/input";
import { Link } from "../../ui/link";
import * as Sidebar from "../../ui/sidebar";
import { Spinner } from "../../ui/spinner";
import { useLocaleStuff } from "../use-formatting";
import { CategoryField, DateField } from "./new-tx-page";

type Tx =
	paths["/transactions/query"]["post"]["responses"]["200"]["content"]["application/json"]["transactions"][number];

export default function TxPage() {
	const [searchParams] = useSearchParams();
	let limit = null;
	const limitParam = searchParams.get("limit");
	if (limitParam) {
		limit = Number(limitParam);
	}

	const left = searchParams.get("left");
	const right = searchParams.get("right");

	const opts = api.queryOptions("post", "/transactions/query", {
		body: {
			search_text: searchParams.get("search_text"),
			limit,
			left,
			right,
		},
	});
	const q = useQuery(opts);

	const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
	const selectedTx = q.data?.transactions.find((t) => t.id === selectedTxId);

	function onTxClick(this: Tx) {
		setSelectedTxId((p) => (p === this.id ? null : this.id));
	}

	return (
		<main className="w-full max-w-[320px]">
			{/* desktop */}
			<div className="bg-gray-1 border-b-gray-4 order-b sticky top-10 hidden pt-2 sm:block">
				<div className="flex gap-1">
					<Search currentSearchParams={searchParams} />
				</div>

				<div className="flex items-center justify-between py-2">
					{q.isPending && <Spinner />}

					<Pagination
						className="ml-auto"
						currentSearchParams={searchParams}
						leftId={q.data?.prev_id}
						rightId={q.data?.next_id}
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
						leftId={q.data?.prev_id}
						rightId={q.data?.next_id}
					/>
				</div>

				<div className="flex gap-1">
					<Search currentSearchParams={searchParams} />
				</div>
			</div>

			{q.isPending ? (
				Loading
			) : q.isError ? (
				"error"
			) : !q.data.transactions.length ? (
				<div className="flex w-full flex-col gap-2 p-4">
					<p className="text-gray-11">no transactions yet</p>
					<Link variant="text" href="/txs/new">
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
							<SelectedTx
								opts={opts}
								unselect={() => setSelectedTxId(null)}
								tx={selectedTx}
							/>
						</div>
					)}

					<TxList onTxClick={onTxClick} list={q.data.transactions} />
				</>
			)}
		</main>
	);
}

function TxList({ list, onTxClick }: { list: Array<Tx>; onTxClick: (this: Tx) => void }) {
	const { f } = useLocaleStuff();

	const thisYear = new Date().getFullYear();
	let lastDate = "";

	return (
		<ul className="grid grid-cols-[max-content_1fr_auto] items-center">
			{list.map((t) => {
				const asDate = new Date(t.date);
				const year = asDate.getFullYear();
				const showYear = year !== thisYear;

				const date = showYear ? f.longDate.format(asDate) : f.shortDate.format(asDate);

				const showDate = date !== lastDate;
				lastDate = date;

				const isPositive = t.amount > 0;

				return (
					<li
						key={t.id}
						data-id={t.id}
						className="group col-[span_3] grid w-full grid-cols-subgrid overflow-hidden text-sm"
						onClick={onTxClick.bind(t)}
					>
						<span
							className={
								"col-[1] flex h-full items-start px-2 py-3 text-sm" +
								(!showDate
									? " invisible group-hover:visible"
									: " border-t-gray-3 border-t")
							}
						>
							{date}
						</span>

						<span className="border-t-gray-3 col-[2] flex items-center truncate border-t p-3">
							<div className="flex flex-col gap-0.5 truncate">
								<span className="truncate">{t.counter_party}</span>
							</div>
						</span>

						<div
							className={
								"border-t-gray-3 col-[3] border-t px-2 py-3 text-right tabular-nums" +
								(isPositive ? " text-green-10" : "")
							}
						>
							{f.amount.format(t.amount)}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

function Tx({ t }: { t: Tx }) {}

function Search({ currentSearchParams }: { currentSearchParams: URLSearchParams }) {
	const [location, setLocation] = useLocation();

	function onSubmit(e: FormEvent<HTMLFormElement>) {
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
				<IconChevronLeft aria-hidden="true" />
				<span className="sr-only">to the left</span>
			</Link>

			<Link
				href={rightId && "?" + nextParams.toString()}
				className="border-gray-5 flex size-8 items-center justify-center rounded-full border"
			>
				<IconChevronRight aria-hidden="true" />
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

function SelectedTx({
	opts,
	tx,
	unselect,
}: {
	opts: UseQueryOptions;
	tx: Tx;
	unselect: () => void;
}) {
	const { f } = useLocaleStuff();

	const qc = useQueryClient();
	const mutation = api.useMutation("post", "/transactions/{id}", {
		onSuccess: () => {
			qc.invalidateQueries(opts);
		},
	});

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (mutation.isPending) return;

		const formData = new FormData(event.currentTarget);

		mutation
			.mutateAsync({
				params: { path: { id: tx.id } },
				body: {
					date: new Date(formData.get("date") as string).toISOString(),
					amount: Number(formData.get("amount")),
					counter_party: formData.get("counter_party") as string,
					currency: "EUR",
					additional: formData.get("additional") as string,
					category_name: formData.get("category_name") as string | null,
				},
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

				<div className="!absolute top-1 right-1">
					<CopyButton value={tx.id} label="copy transaction id" />
					<Sidebar.Close asChild>
						<Button size="icon" variant="ghost" autoFocus>
							<IconCross />
						</Button>
					</Sidebar.Close>
				</div>

				<p className="text-base">{f.amount.format(tx.amount)}</p>

				<p>{f.sidebarDate.format(new Date(tx.date))}</p>

				<p className="text-gray-11 break-words">{tx.additional}</p>

				<div className="mt-3 flex flex-col gap-2">
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

							<Input label="amount" name="amount" defaultValue={tx.amount} />

							<DateField label="date" name="date" defaultValue={tx.date} />

							<CategoryField
								name="category_name"
								label="category"
								defaultValue={tx.category?.name}
							/>

							<Input
								name="additional"
								label="additional"
								defaultValue={tx.additional ?? undefined}
							/>

							<div className="flex justify-between gap-2">
								<DeleteTransaction
									opts={opts}
									id={tx.id}
									counterParty={tx.counter_party}
								/>

								<Button type="submit" isLoading={mutation.isPending}>
									save
								</Button>
							</div>
						</form>
					</details>

					<Links opts={opts} tx={tx} links={tx.links} />
				</div>
			</Sidebar.Content>
		</Sidebar.Root>
	);
}

function CopyButton({ label, value }: { label: string; value: string }) {
	const [Icon, setIcon] = useState(() => IconCopy);
	const timeoutRef = useRef<number | null>(null);

	function onClick() {
		navigator.clipboard.writeText(value);

		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}

		setIcon(() => IconCheck);
		timeoutRef.current = setTimeout(() => {
			setIcon(() => IconCopy);
		}, 1000);
	}

	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<Button size="icon" variant="ghost" onClick={onClick}>
					<Icon />
				</Button>
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content className="bg-gray-1 border-gray-5 z-10 border p-2">
					{label}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}

function Links({ opts, tx, links }: { opts: UseQueryOptions; tx: Tx; links: Tx["links"] }) {
	const qc = useQueryClient();
	const linkMutation = api.useMutation("post", "/transactions/{id}/linked", {
		onSuccess: () => qc.invalidateQueries(opts),
	});
	const unlinkMutation = api.useMutation("post", "/transactions/{id}/linked", {
		onSuccess: () => qc.invalidateQueries(opts),
	});

	const { f } = useLocaleStuff();

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (linkMutation.isPending) return;

		const givenId = event.currentTarget.link_id.value as string;
		if (givenId === tx.id) {
			toast.error("cant link with same transaction");
			return;
		}
		linkMutation
			.mutateAsync({
				params: { path: { id: givenId } },
				body: { id: tx.id },
			})
			.catch(errorToast("error updating transaction"));
	}

	function onDelete({ otherTxId }: { otherTxId: string }) {
		if (unlinkMutation.isPending) return;

		unlinkMutation
			.mutateAsync({
				params: { path: { id: otherTxId } },
				body: { id: tx.id },
			})
			.catch(errorToast("error deleting link"));
	}

	return (
		<details className="w-full">
			<summary className="border-gray-5 focus h-10 border px-3 py-2">
				<span className="leading-none select-none">links</span>
			</summary>

			<form onSubmit={onSubmit} className="flex w-full items-end gap-2 pt-2">
				<Input
					label="tx id"
					name="link_id"
					className="w-full"
					autoCapitalize="off"
					autoComplete="off"
					autoCorrect="off"
				/>

				<Button type="submit" isLoading={linkMutation.isPending}>
					add
				</Button>
			</form>

			{!!links.length && (
				<ul className="space-y-2 pt-4">
					{links.map((l) => (
						<li className="border-gray-5 relative flex flex-col gap-1 border p-2">
							<div className="absolute top-1 right-1">
								<Button
									className="!h-8 !px-1.5 text-xs"
									variant="destructive"
									onClick={() => onDelete({ otherTxId: l.tx.id })}
									isLoading={unlinkMutation.isPending}
								>
									delete
								</Button>
							</div>
							<span className="truncate pe-14">{l.tx.counter_party}</span>
							<span>{f.amount.format(l.tx.amount)}</span>
							<span>{f.sidebarDate.format(new Date(l.tx.date))}</span>
						</li>
					))}
				</ul>
			)}
		</details>
	);
}

function DeleteTransaction({
	opts,
	id,
	counterParty,
}: {
	opts: UseQueryOptions;
	id: string;
	counterParty: string;
}) {
	const qc = useQueryClient();
	const mutation = api.useMutation("delete", "/transactions/{id}", {
		onSuccess: () => qc.invalidateQueries(opts),
	});

	function onConfirm() {
		if (mutation.isPending) return;

		mutation
			.mutateAsync({ params: { path: { id } } })
			.catch(errorToast("error deleting transaction"));
	}

	return (
		<Dialog.Root>
			<Dialog.Trigger asChild>
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
