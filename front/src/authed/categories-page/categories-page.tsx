import { DotsVerticalIcon, Pencil1Icon, TrashIcon } from "@radix-ui/react-icons";
import type { FormEvent } from "react";
import { useSearch, useSearchParams } from "wouter";

import { errorToast } from "../../lib/error-toast";
import { trpc } from "../../lib/trpc";
import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import * as Dialog from "../../ui/dialog";
import * as Dropdown from "../../ui/dropdown";
import { Input } from "../../ui/input";
import { FastLink, Link } from "../../ui/link";
import { useDialog } from "../../ui/use-dialog";

type Category = {
	id: string;
	name: string;
	is_neutral: boolean;
};

const countFormat = new Intl.NumberFormat(undefined, {
	notation: "compact",
	maximumFractionDigits: 1,
});

export default function CategoriesPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const query = searchParams.get("query") ?? undefined;

	const q = trpc.v1.categories.query.useQuery({ query });

	function onSearch(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const query = formData.get("query") as string | null;

		const newSearchParams = new URLSearchParams(searchParams);
		if (query) {
			newSearchParams.set("query", query);
		} else {
			newSearchParams.delete("query");
		}

		setSearchParams(newSearchParams);
	}

	return (
		<div className="w-full max-w-md space-y-3">
			<form onSubmit={onSearch} className="bg-gray-1 sticky top-10 pt-2">
				<Input placeholder="search categories..." name="query" />
			</form>

			{q.isLoading ? (
				<p>loading</p>
			) : q.isError ? (
				<p>error</p>
			) : q.data?.length ? (
				<ul className="divide-gray-3 divide-y">
					{q.data?.map((c) => (
						<li
							key={c.id}
							className="flex items-center justify-between gap-2 py-1 ps-2"
						>
							<div className="truncate">
								<p className="truncate">{c.name}</p>
								<p className="text-gray-10 mt-0.5 text-xs">
									{countFormat.format(c.transaction_count)}{" "}
									{c.transaction_count === 1n ? "transaction" : "transactions"}
								</p>

								<p className="text-gray-10 mt-0.5 text-xs">
									{c.is_neutral ? "neutral" : null}
								</p>
							</div>
							<CategoryMenu category={c} />
						</li>
					))}
				</ul>
			) : query ? (
				<p>no matches</p>
			) : (
				<p className="text-gray-11">no categories yet</p>
			)}
		</div>
	);
}

function CategoryMenu({ category }: { category: Category }) {
	return (
		<Dropdown.Root>
			<Dropdown.Trigger asChild>
				<Button variant="ghost" size="icon">
					<DotsVerticalIcon />
				</Button>
			</Dropdown.Trigger>

			<Dropdown.Content>
				<EditCategory category={category} />
				<DeleteCategory category={category} />
			</Dropdown.Content>
		</Dropdown.Root>
	);
}

function DeleteCategory({ category }: { category: Category }) {
	const dialog = useDialog();

	const t = trpc.useUtils();
	const mutation = trpc.v1.categories.delete.useMutation({
		onSuccess: () => {
			t.v1.categories.query.invalidate();
		},
	});

	function onDelete() {
		if (mutation.isPending) return;
		mutation.mutateAsync({ id: category.id }).catch(errorToast("error deleting category"));
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

function EditCategory({ category }: { category: Category }) {
	const dialog = useDialog();

	const t = trpc.useUtils();
	const mutation = trpc.v1.categories.edit.useMutation({
		onSuccess: () => {
			t.v1.categories.query.invalidate();
		},
	});

	function onEdit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (mutation.isPending) return;

		const formData = new FormData(e.currentTarget);

		mutation
			.mutateAsync({
				id: category.id,
				name: formData.get("name") as string,
				is_neutral: formData.get("is_neutral") === "on",
			})
			.then(dialog.close)
			.catch(errorToast("error saving"));
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
					<Pencil1Icon className="text-gray-10" />
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
