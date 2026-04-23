import { DotsVerticalIcon, TrashIcon } from "@radix-ui/react-icons";
import { useState, type FormEvent } from "react";
import { Button } from "../../components/button";
import * as Dialog from "../../components/dialog";
import * as Dropdown from "../../components/dropdown";
import { Empty } from "../../components/empty";
import { IconCross } from "../../components/icons/cross";
import { IconDividerVertical } from "../../components/icons/divider-vertical";
import { IconEdit } from "../../components/icons/edit";
import { Input } from "../../components/input";
import { Select } from "../../components/select";
import { useDialog } from "../../components/use-dialog";
import {
	useAccountsWithCountQuery,
	useCreateAccountMutation,
	useDeleteAccountMutation,
	useUpdateAccountMutation,
	type AccountWithCount,
} from "../../lib/queries/accounts";
import { COMMON_CURRENCIES, DEFAULT_CURRENCY } from "../../lib/currency";

export function AccountsPage() {
	const [search, setSearch] = useState("");
	const query = useAccountsWithCountQuery(search || undefined);

	return (
		<div className="w-full mx-auto max-w-[25rem] mt-14">
			<div className="mb-4 flex items-center justify-between gap-3">
				<h1 className="text-lg">accounts</h1>
			</div>

			<Input
				type="text"
				placeholder="search accounts..."
				className="mb-4 w-full"
				value={search}
				onChange={(e) => setSearch(e.currentTarget.value)}
			/>

			<CreateAccountForm />

			{query.data && (
				<ul className="mt-4">
					{query.data.map((account) => (
						<AccountRow key={account.id} account={account} />
					))}
				</ul>
			)}

			{query.data?.length === 0 && (
				<Empty>{search ? "no results" : "no accounts yet"}</Empty>
			)}
		</div>
	);
}

function CreateAccountForm() {
	const createAccount = useCreateAccountMutation();

	async function handleSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const data = new FormData(form);

		const name = (data.get("name") as string).trim();
		if (!name) return;

		const currency = (data.get("currency") as string) || DEFAULT_CURRENCY;
		const externalId = (data.get("external_id") as string | null)?.trim() || null;
		await createAccount.mutateAsync({ name, currency, external_id: externalId });
		form.reset();
		(form.name as unknown as HTMLInputElement | undefined)?.focus();
	}

	return (
		<form onSubmit={handleSubmit}>
			<fieldset className="flex border border-gray-a3 p-2.5">
				<legend className="font-medium text-xs">new account</legend>

				<div className="flex flex-col gap-3 w-full mr-2 -mt-0.5">
					<Input id="name" label="name" name="name" type="text" className="flex-1" required />
					<Input
						label="external id (optional)"
						name="external_id"
						type="text"
						className="flex-1"
						placeholder="e.g. IBAN"
					/>
					<Select label="currency" name="currency" defaultValue={DEFAULT_CURRENCY}>
						{COMMON_CURRENCIES.map((code) => (
							<option key={code} value={code}>
								{code}
							</option>
						))}
					</Select>
				</div>

				<Button type="submit" className="mt-5">add</Button>
			</fieldset>
		</form>
	);
}

function AccountRow({ account }: { account: AccountWithCount }) {
	const [editing, setEditing] = useState<"name" | "external_id" | "currency" | boolean>(false);
	const updateAccount = useUpdateAccountMutation();

	async function handleSave(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const data = new FormData(form);

		const name = (data.get("name") as string).trim();
		if (!name) return;

		const currency = (data.get("currency") as string) || DEFAULT_CURRENCY;
		const externalId = (data.get("external_id") as string | null)?.trim() || null;
		await updateAccount.mutateAsync({
			id: account.id,
			name,
			currency,
			external_id: externalId,
		});
		setEditing(false);
	}

	return (
		<li className="border-gray-a3 border-b py-2">
			{editing ? (
				<form className="flex gap-3" onSubmit={handleSave}>
					<div className="flex flex-col gap-3 w-full">
						<Input
							autoFocus={editing === "name"}
							label="name"
							name="name"
							type="text"
							className="flex-1"
							required
							defaultValue={account.name}
						/>
						<Input
							autoFocus={editing === "external_id"}
							label="external id (optional)"
							name="external_id"
							type="text"
							className="flex-1"
							defaultValue={account.external_id ?? ""}
							placeholder="e.g. IBAN"
						/>
						<Select
							label="currency"
							name="currency"
							defaultValue={account.currency}
						>
							{COMMON_CURRENCIES.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</Select>
					</div>

					<div className="flex mt-5 gap-2">
						<Button type="submit">save</Button>
						<Button size="icon" variant="ghost" type="button" onClick={() => setEditing(false)}>
							<IconCross />
						</Button>
					</div>
				</form>
			) : (
				<div className="flex items-center justify-between gap-0.5">
					<div className="flex flex-col">
						<button
							title="edit"
							className="contents cursor-pointer"
							onClick={() => {
								setEditing("name");
							}}
						>
							{account.name}
						</button>
						<div className="flex gap-0.5 items-center">
							<span className="text-gray-10 text-xs">{account.tx_count} tx</span>

							<button
								title="edit"
								className="contents cursor-pointer"
								onClick={() => {
									setEditing("currency");
								}}
							>
								<IconDividerVertical className="text-gray-10" />

								<span className="text-xs text-gray-11">{account.currency}</span>
							</button>
						</div>
						{account.external_id && (
							<button
								title="edit"
								className="contents cursor-pointer"
								onClick={() => {
									setEditing("external_id");
								}}
							>
								<span className="text-xs text-gray-10">external id: {account.external_id}</span>
							</button>
						)}
					</div>

					<AccountMenu account={account} onEdit={() => setEditing(true)} />
				</div>
			)}
		</li>
	);
}

function AccountMenu({ account, onEdit }: { account: AccountWithCount; onEdit: () => any }) {
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
				<DeleteAccount account={account} />
			</Dropdown.Content>
		</Dropdown.Root>
	);
}

function DeleteAccount({ account }: { account: AccountWithCount }) {
	const dialog = useDialog();
	const mutation = useDeleteAccountMutation();

	function onDelete() {
		if (mutation.isPending) return;
		if (account.tx_count) return;

		mutation.mutateAsync(account.id).then(() => {
			dialog.close();
		});
	}

	return (
		<Dialog.Root {...dialog.props}>
			<Dialog.Trigger asChild>
				<Dropdown.Item
					onSelect={(e) => {
						if (account.tx_count) return;
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
					<Dialog.Title>delete account</Dialog.Title>
					<Dialog.Desc>delete "{account.name}"?</Dialog.Desc>
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
