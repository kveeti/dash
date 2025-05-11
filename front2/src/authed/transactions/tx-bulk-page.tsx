import { CheckIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import * as Rac from "react-aria-components";
import { useAsyncList } from "react-stately";

import { api, fetchClient } from "../../api";
import { IconCalendar } from "../../ui/icons/calendar";
import { useLocaleStuff } from "../use-formatting";
import { Tx } from "./tx-page";

export default function TxBulkPage() {
	const opts = api.queryOptions("post", "/transactions/query", {
		body: {},
	});
	const q = useQuery(opts);

	const { f } = useLocaleStuff();
	let [sortDescriptor, setSortDescriptor] = useState<Rac.SortDescriptor>({
		column: "symbol",
		direction: "ascending",
	});

	const list = useAsyncList<Tx>({
		load: async ({ signal }) => {
			const res = await fetchClient.POST("/transactions/query", {
				signal,
				body: {},
			});

			if (res.error) {
				throw "error";
			}

			return {
				items: res.data.transactions,
			};
		},
	});

	return (
		<main className="w-full">
			{
				q.isLoading ? (
					"loading"
				) : q.isError ? (
					"error"
				) : (
					<Rac.ResizableTableContainer>
						<Rac.Table
							aria-label="Stocks"
							selectionMode="multiple"
							selectionBehavior="replace"
							sortDescriptor={sortDescriptor}
							onSortChange={setSortDescriptor}
							className="border-separate border-spacing-0"
						>
							<Rac.TableHeader>
								<Col id="counter_party" allowsSorting isRowHeader>
									counter party
								</Col>

								<Col id="amount" allowsSorting>
									amount
								</Col>

								<Col id="category" allowsSorting>
									category
								</Col>
							</Rac.TableHeader>

							<Rac.TableBody items={list.items}>
								{(item) => (
									<Rac.Row className="data-selected:bg-gray-a4">
										<Rac.Cell className="truncate px-4 py-1">
											{item.counter_party}
										</Rac.Cell>

										<Rac.Cell className="flex justify-end px-4">
											{item.amount}
										</Rac.Cell>

										<Rac.Cell className="px-4">
											{item.category?.name ?? "uncategorized"}
										</Rac.Cell>
									</Rac.Row>
								)}
							</Rac.TableBody>
						</Rac.Table>
					</Rac.ResizableTableContainer>
				)
				// 		(
				// 	<Rac.Virtualizer
				// 		layout={Rac.ListLayout}
				// 		layoutOptions={{
				// 			rowHeight: 36,
				// 			padding: 4,
				// 			gap: 4,
				// 		}}
				// 	>
				// 		<Rac.GridList
				// 			selectionMode="multiple"
				// 			className="grid grid-cols-[max-content_1fr_auto_auto] items-center"
				// 		>
				// 			{q.data?.transactions.map((t) => {
				// 				return (
				// 					<Rac.GridListItem className="focus data-selected:bg-gray-a4 col-[span_4] grid w-full grid-cols-subgrid items-center gap-3 overflow-hidden p-2 text-sm">
				// 						<Rac.Checkbox className="block" slot="selection">
				// 							{({ isSelected }) => (
				// 								<div className="border-gray-a4 size-4 border">
				// 									{isSelected && <CheckIcon />}
				// 								</div>
				// 							)}
				// 						</Rac.Checkbox>
				//
				// 						<span className="truncate">{t.counter_party}</span>
				//
				// 						<span className={!t.category?.name ? "text-red-10" : ""}>
				// 							{t.category?.name ?? "uncategorized"}
				// 						</span>
				//
				// 						<span className="flex w-full justify-end">
				// 							{f.amount.format(t.amount)}
				// 						</span>
				// 					</Rac.GridListItem>
				// 				);
				// 			})}
				// 		</Rac.GridList>
				// 	</Rac.Virtualizer>
				// )
			}
		</main>
	);
}

function Col(props: Rac.ColumnProps & { children: React.ReactNode; resizeable?: boolean }) {
	return (
		<Rac.Column
			{...props}
			className="sticky top-0 cursor-default border-0 border-b border-solid border-slate-300 bg-slate-200 p-0 text-left font-bold whitespace-nowrap outline-hidden"
		>
			{({ allowsSorting, sortDirection }) => (
				<div className="flex h-10 items-center">
					<Rac.Group
						role="presentation"
						tabIndex={-1}
						className="flex flex-1 items-center overflow-hidden ring-slate-600 outline-hidden focus-visible:ring-2"
					>
						<span className="flex-1 truncate">{props.children}</span>
						{allowsSorting && (
							<span
								className={`ml-1 flex h-4 w-4 items-center justify-center transition ${
									sortDirection === "descending" ? "rotate-180" : ""
								}`}
							>
								{sortDirection && <IconCalendar />}
							</span>
						)}
					</Rac.Group>
					{props.resizeable && (
						<Rac.ColumnResizer className="resizing:bg-slate-800 resizing:w-[2px] resizing:pl-[7px] h-5 w-px cursor-col-resize bg-slate-400 bg-clip-content px-[8px] py-1 ring-slate-600 ring-inset focus-visible:ring-2" />
					)}
				</div>
			)}
		</Rac.Column>
	);
}
