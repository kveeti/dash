import { DotsVerticalIcon, Pencil1Icon, TrashIcon } from "@radix-ui/react-icons";

import type { Category } from "../../../../back/src/data/transactions";
import { trpc } from "../../lib/trpc";
import { Button } from "../../ui/button";
import * as Dialog from "../../ui/dialog";
import * as Dropdown from "../../ui/dropdown";
import { Input } from "../../ui/input";
import { useDialog } from "../../ui/use-dialog";

export function CategoriesPage() {
	const q = trpc.v1.categories.query.useQuery({});

	if (q.isError) {
		return <div>error</div>;
	}

	if (q.isLoading) {
		return <div>loading</div>;
	}

	return (
		<div className="w-full max-w-xs space-y-3">
			<Input placeholder="search categories..." />

			<ul className="divide-gray-3 divide-y">
				{q.data?.map((c) => (
					<li key={c.id} className="flex items-center justify-between gap-2 p-1">
						{c.name}
						<div className="flex items-center gap-2">
							<CategoryMenu category={c} />
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}

function CategoryMenu({ category }: { category: Category }) {
	return (
		<Dropdown.Root>
			<Dropdown.Trigger asChild>
				<Button>
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
						<Button>cancel</Button>
					</Dialog.Close>
					<Button>yes, delete</Button>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}

function EditCategory({ category }: { category: Category }) {
	const dialog = useDialog();

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

				<form className="mt-3 mb-5">
					<Input label="name" defaultValue={category.name} />
				</form>

				<div className="flex justify-end gap-3">
					<Dialog.Close asChild>
						<Button>cancel</Button>
					</Dialog.Close>
					<Button>save</Button>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}
