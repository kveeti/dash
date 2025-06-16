import { DotsVerticalIcon, TrashIcon } from "@radix-ui/react-icons";
import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, startTransition } from "react";
import { AsyncListData, useAsyncList } from "react-stately";
import { toast } from "sonner";
import { useSearchParams } from "wouter";

import { api, fetchClient } from "../api";
import { paths } from "../api_types";
import { errorToast } from "../lib/error-toast";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import * as Dialog from "../ui/dialog";
import * as Dropdown from "../ui/dropdown";
import { IconEdit } from "../ui/icons/edit";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { useDialog } from "../ui/use-dialog";
import { useLocaleStuff } from "./use-formatting";

export default function CatsPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const query = searchParams.get("query");

	const list = useAsyncList<{ id: string; name: string }>({
		initialFilterText: query ?? "",
		load: async ({ signal, filterText }) => {
			const res = await fetchClient.GET("/v1/categories", {
				signal,
				params: { query: { search_text: filterText, include_counts: true } },
			});

			if (res.error) {
				throw "error";
			}

			return {
				items: res.data,
			};
		},
	});

	return (
		<main className="w-full max-w-[400px] px-1">
			<Input
				placeholder="search categories..."
				value={list.filterText}
				onChange={(e) => {
					startTransition(() => {
						const value = e.target.value;
						list.setFilterText(value);
						setSearchParams({ query: value });
					});
				}}
			/>

			<Categories list={list} />
		</main>
	);
}

function Categories({
	list,
}: {
	list: AsyncListData<{ id: string; name: string; is_neutral: boolean; tx_count: number }>;
}) {
	const { f } = useLocaleStuff();

	if (list.isLoading) {
		return (
			<div className="flex h-50 w-full items-center justify-center">
				<Spinner />
			</div>
		);
	}

	if (list.error) {
		return <div>error {JSON.stringify(q.error)}</div>;
	}

	if (!list.items?.length) {
		return (
			<p className="flex h-50 w-full items-center justify-center">
				{list.filterText ? "no results" : "no categories yet"}
			</p>
		);
	}

	return (
		<ul className="mt-2">
			{list.items.map((c) => (
				<li className="flex items-center justify-between gap-2 py-1 ps-2">
					<div className="truncate">
						<p className="truncate">{c.name}</p>
						<p className="text-gray-10 mt-0.5 text-xs">
							{f.count.format(c.tx_count)}{" "}
							{c.tx_count === 1 ? "transaction" : "transactions"}
						</p>

						<p className="text-gray-10 mt-0.5 text-xs">
							{c.is_neutral ? "neutral" : null}
						</p>
					</div>
					<CategoryMenu category={c} reload={list.reload} />
				</li>
			))}
		</ul>
	);
}

function CategoryMenu({ category, reload }: { category: Category; reload: () => any }) {
	return (
		<Dropdown.Root>
			<Dropdown.Trigger asChild>
				<Button variant="ghost" size="icon">
					<DotsVerticalIcon />
				</Button>
			</Dropdown.Trigger>

			<Dropdown.Content>
				<EditCategory category={category} reload={reload} />
				<DeleteCategory category={category} reload={reload} />
			</Dropdown.Content>
		</Dropdown.Root>
	);
}

export type Category =
	paths["/categories"]["get"]["responses"]["200"]["content"]["application/json"][number] & {
		tx_count?: number;
	};

function DeleteCategory({ category, reload }: { category: Category; reload: () => any }) {
	const dialog = useDialog();

	const qc = useQueryClient();
	const mutation = api.useMutation("delete", "/categories/{id}", {
		onSuccess: () => {
			qc.invalidateQueries(api.queryOptions("get", "/categories"));
			reload();
		},
	});

	function onDelete() {
		if (mutation.isPending) return;

		if (category.tx_count) {
			toast.error("cannot delete a category with transactions");
			return;
		}

		mutation
			.mutateAsync({ params: { path: { id: category.id } } })
			.then(() => {
				toast.success("category deleted");
				dialog.close();
			})
			.catch(errorToast("error deleting category"));
	}

	return (
		<Dialog.Root {...dialog.props}>
			<Dialog.Trigger asChild>
				<Dropdown.Item
					onSelect={(e) => {
						if (category.tx_count) {
							toast.error("cannot delete a category with transactions");
							return;
						}
						e.preventDefault();
						dialog.open();
					}}
				>
					<TrashIcon className="text-gray-10" />
					<span className="ms-3">delete</span>
				</Dropdown.Item>
			</Dialog.Trigger>

			<Dialog.Content>
				<div className="space-y-2">
					<Dialog.Title>delete category</Dialog.Title>
					<Dialog.Desc>delete "{category.name}"?</Dialog.Desc>
				</div>

				<div className="mt-5 flex justify-end gap-3">
					<Dialog.Close asChild>
						<Button variant="ghost">cancel</Button>
					</Dialog.Close>
					<Button variant="destructive" onClick={onDelete}>
						yes, delete
					</Button>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}

function EditCategory({ category, reload }: { category: Category; reload: () => any }) {
	const dialog = useDialog();

	const qc = useQueryClient();
	const mutation = api.useMutation("patch", "/categories/{id}", {
		onSuccess: () => {
			qc.invalidateQueries(api.queryOptions("get", "/categories"));
			reload();
		},
	});

	function onEdit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (mutation.isPending) return;

		const formData = new FormData(e.currentTarget);

		mutation
			.mutateAsync({
				params: { path: { id: category.id } },
				body: {
					name: formData.get("name") as string,
					is_neutral: formData.get("is_neutral") === "on",
				},
			})
			.then(() => {
				toast.success("category saved");
				dialog.close();
			})
			.catch(errorToast("error saving category"));
	}

	return (
		<Dialog.Root {...dialog.props}>
			<Dialog.Trigger asChild>
				<Dropdown.Item
					onSelect={(e) => {
						e.preventDefault();
						dialog.open();
					}}
				>
					<IconEdit className="text-gray-10 size-4" />
					<span className="ms-3">edit</span>
				</Dropdown.Item>
			</Dialog.Trigger>

			<Dialog.Content>
				<Dialog.Title>edit category</Dialog.Title>

				<form className="mt-3" onSubmit={onEdit}>
					<div className="space-y-4">
						<Input
							required
							label="name"
							name="name"
							defaultValue={category.name ?? ""}
						/>
						<Checkbox
							name="is_neutral"
							label="is neutral"
							defaultChecked={category.is_neutral}
						/>
					</div>

					<div className="mt-5 flex justify-end gap-3">
						<Dialog.Close asChild disabled={mutation.isPending}>
							<Button variant="ghost">cancel</Button>
						</Dialog.Close>
						<Button isLoading={mutation.isPending}>save</Button>
					</div>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	);
}
