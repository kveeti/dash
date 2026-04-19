import { useState } from "react";
import { Button } from "../../components/button";
import { Empty } from "../../components/empty";
import { Input } from "../../components/input";
import * as Dropdown from "../../components/dropdown";
import * as Dialog from "../../components/dialog";
import {
	useCategoriesQuery,
	useCreateCategoryMutation,
	useUpdateCategoryMutation,
	useDeleteCategoryMutation,
	type CategoryWithCount,
} from "../../lib/queries/categories";
import { Checkbox } from "../../components/checkbox";
import { IconDividerVertical } from "../../components/icons/divider-vertical";
import { IconCross } from "../../components/icons/cross";
import { DotsVerticalIcon, TrashIcon } from "@radix-ui/react-icons";
import { IconEdit } from "../../components/icons/edit";
import { useDialog } from "../../components/use-dialog";
import { useQueryClient } from "@tanstack/react-query";

export function CategoriesPage() {
	const [search, setSearch] = useState("");

	const query = useCategoriesQuery(search || undefined);

	return (
		<div className="w-full mx-auto max-w-[25rem] mt-14">
			<div className="mb-4 flex items-center justify-between gap-3">
				<h1 className="text-lg">categories</h1>
			</div>

			<Input
				type="text"
				placeholder="search categories..."
				className="mb-4 w-full"
				value={search}
				onChange={(e) => setSearch(e.currentTarget.value)}
			/>

			<CreateCategoryForm />

			{query.data && (
				<ul className="mt-4">
					{query.data.map((cat) => (
						<CategoryRow key={cat.id} category={cat} />
					))}
				</ul>
			)}

			{query.data?.length === 0 && (
				<Empty>{search ? "no results" : "no categories yet"}</Empty>
			)}
		</div>
	);
}

function CreateCategoryForm() {
	const createCategory = useCreateCategoryMutation();

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const data = new FormData(form);

		const name = (data.get("name") as string).trim();
		if (!name) return;

		await createCategory.mutateAsync({ name, is_neutral: data.has("is_neutral") });
		form.reset();
		(form.name as unknown as HTMLInputElement | undefined)?.focus()
	}

	return (
		<form onSubmit={handleSubmit}>
			<fieldset className="flex border border-gray-a3 p-2.5">
				<legend className="font-medium text-xs">new category</legend>

				<div className="flex flex-col gap-3 w-full mr-2 -mt-0.5">
					<Input id="name" label="name" name="name" type="text" className="flex-1" required />
					<Checkbox label="is neutral" name="is_neutral" />
				</div>

				<Button type="submit" className="mt-5">add</Button>
			</fieldset>
		</form>
	);
}

function CategoryRow({ category }: { category: CategoryWithCount }) {
	const [editing, setEditing] = useState<"checkbox" | "input" | false>(false);
	const updateCategory = useUpdateCategoryMutation();
	const deleteCategory = useDeleteCategoryMutation();

	async function handleSave(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const data = new FormData(form);

		const name = (data.get("name") as string).trim();
		if (!name) return;

		await updateCategory.mutateAsync({ id: category.id, name, is_neutral: data.has("is_neutral") });
		setEditing(false);
	}


	return (
		<li className="border-gray-a3 border-b py-2">
			{editing ? (
				<form className="flex gap-3 " onSubmit={handleSave}>
					<div className="flex flex-col gap-3 w-full">
						<Input autoFocus={editing === "input"} label="name" name="name" type="text" className="flex-1" required defaultValue={category.name} />
						<Checkbox autoFocus={editing === "checkbox"} label="is neutral" name="is_neutral" defaultChecked={!!category.is_neutral} />
					</div>

					<div className="flex mt-5 gap-2">
						<Button type="submit">save</Button>
						<Button size="icon" variant="ghost" type="button" onClick={() => setEditing(false)}><IconCross /></Button>
					</div>
				</form>
			) : (
				<div className="flex items-center justify-between gap-0.5">
					<div className="flex flex-col">
						<button title="edit" className="contents cursor-pointer" onClick={() => {
							setEditing("input")
						}}>
							{category.name}
						</button>
						<div className="flex gap-0.5 items-center">
							<span className="text-gray-10 text-xs">{category.tx_count} tx</span>

							<button title="edit" className="contents cursor-pointer" onClick={() => {
								setEditing("checkbox")
							}}>
								<IconDividerVertical className="text-gray-10" />

								<span className={"text-xs" + (" " + (category.is_neutral ? "text-gray-11" : "text-gray-10"))}>{category.is_neutral ? "neutral" : "not neutral"}</span>
							</button>
						</div>
					</div>

					<CategoryMenu category={category} onEdit={() => setEditing(true)} />
				</div>
			)}
		</li>
	);
}

function CategoryMenu({ category, onEdit }: { category: CategoryWithCount; onEdit: () => any }) {
	return (
		<Dropdown.Root>
			<Dropdown.Trigger asChild>
				<Button variant="ghost" size="icon">
					<DotsVerticalIcon />
				</Button>
			</Dropdown.Trigger>

			<Dropdown.Content>
				<Dropdown.Item
					onSelect={(e) => {
						e.preventDefault();
						onEdit();
					}}
				>
					<IconEdit className="text-gray-10 size-4" />
					<span className="ms-3">edit</span>
				</Dropdown.Item>
				<DeleteCategory category={category} />
			</Dropdown.Content>
		</Dropdown.Root>
	);
}

function DeleteCategory({ category, }: { category: CategoryWithCount; }) {
	const dialog = useDialog();

	const qc = useQueryClient();
	const mutation = useDeleteCategoryMutation();

	function onDelete() {
		if (mutation.isPending) return;

		if (category.tx_count) {
			//toast.error("cannot delete a category with transactions");
			return;
		}

		mutation
			.mutateAsync(category.id)
			.then(() => {
				//toast.success("category deleted");
				dialog.close();
			})
		//.catch(errorToast("error deleting category"));
	}

	return (
		<Dialog.Root {...dialog.props}>
			<Dialog.Trigger asChild>
				<Dropdown.Item
					onSelect={(e) => {
						if (category.tx_count) {
							//toast.error("cannot delete a category with transactions");
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

				<div className="mt-5 flex justify-end gap-2">
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
