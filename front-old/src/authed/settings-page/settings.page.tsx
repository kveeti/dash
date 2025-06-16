import * as Ariakit from "@ariakit/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import * as v from "valibot";

import { errorToast } from "../../lib/error-toast";
import { useMe } from "../../lib/me";
import { trpc } from "../../lib/trpc";
import { Button } from "../../ui/button";
import * as Dialog from "../../ui/dialog";
import { Input, inputStyles } from "../../ui/input";
import { Heading } from "../../ui/typography";
import { useDialog } from "../../ui/use-dialog";
import { ComboboxItem, ComboboxPopover } from "../new-transaction-page/new-transaction-fields";

export default function SettingsPage() {
	const { me, setMe } = useMe();
	const t = trpc.useUtils();
	const mutation = trpc.v1.users.updateSettings.useMutation({
		onSuccess() {
			t.v1.users.me.invalidate();
		},
	});

	function onSave(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (mutation.isPending) return;

		const form = e.currentTarget;
		const locale = form.locale.value;

		mutation.mutateAsync({ locale }).then(setMe).catch(errorToast("error saving settings"));
	}

	return (
		<div className="flex w-full max-w-sm flex-col gap-6">
			<form className="space-y-4" onSubmit={onSave}>
				<Heading>settings</Heading>

				<div className="flex items-center justify-between gap-4">
					<div>locale</div>
					<LocaleField defaultValue={me?.preferences?.locale} />
				</div>

				<div className="flex justify-end">
					<Button type="submit">save</Button>
				</div>
			</form>

			<div className="flex items-center justify-between gap-4">
				<h2>password</h2>
				<ChangePassword />
			</div>
		</div>
	);
}

const locales = ["fi-FI", "en-US"];

function LocaleField({ defaultValue }: { defaultValue?: string }) {
	return (
		<div>
			<Ariakit.ComboboxProvider
				defaultValue={defaultValue}
				setValue={(value) => {
					localStorage.setItem("locale", value);
				}}
				id="locale"
			>
				<Ariakit.Combobox
					className={inputStyles}
					autoSelect
					autoComplete="list"
					name="locale"
				/>
				<ComboboxPopover gutter={4} sameWidth>
					{locales.map((locale) => (
						<ComboboxItem key={locale} value={locale}>
							{locale}
						</ComboboxItem>
					))}
				</ComboboxPopover>
			</Ariakit.ComboboxProvider>
		</div>
	);
}

const changePasswordSchema = v.object({
	oldPassword: v.string(),
	newPassword: v.string(),
	newPasswordAgain: v.string(),
});

function ChangePassword() {
	const mutation = trpc.v1.auth.changePassword.useMutation();
	const [noMatch, setNoMatch] = useState(false);
	const dialog = useDialog();

	function onSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (mutation.isPending) return;

		const data = Object.fromEntries(new FormData(e.currentTarget));
		if (!v.is(changePasswordSchema, data)) return;
		if (data.newPassword !== data.newPasswordAgain) {
			setNoMatch(true);
			return;
		}
		setNoMatch(false);

		mutation
			.mutateAsync({ oldPassword: data.oldPassword, newPassword: data.newPassword })
			.then(() => {
				toast.success("password changed");
				dialog.close();
			})
			.catch(errorToast("error changing password"));
	}

	return (
		<Dialog.Root {...dialog.props}>
			<Dialog.Trigger asChild>
				<Button>change password</Button>
			</Dialog.Trigger>

			<Dialog.Content>
				<form onSubmit={onSubmit}>
					<Dialog.Title className="mb-3">change password</Dialog.Title>

					<Input label="old password" type="password" name="oldPassword" />
					<Input
						label="new password"
						type="password"
						error={noMatch && "passwords dont match"}
						name="newPassword"
						className="mt-2"
					/>
					<Input
						label="new password again"
						type="password"
						error={noMatch && "passwords dont match"}
						name="newPasswordAgain"
						className="mt-2"
					/>

					<div className="mt-5 flex justify-end gap-3">
						<Dialog.Close asChild>
							<Button variant="ghost">cancel</Button>
						</Dialog.Close>
						<Button isLoading={mutation.isPending}>change</Button>
					</div>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	);
}
