import * as Ariakit from "@ariakit/react";
import type { FormEvent } from "react";

import { errorToast } from "../../lib/error-toast";
import { useMe } from "../../lib/me";
import { trpc } from "../../lib/trpc";
import { Button } from "../../ui/button";
import { inputStyles } from "../../ui/input";
import { Heading } from "../../ui/typography";
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
		<form className="w-full max-w-sm space-y-6" onSubmit={onSave}>
			<Heading>settings</Heading>

			<div className="flex items-center justify-between gap-4">
				<div>locale</div>
				<LocaleField defaultValue={me?.preferences?.locale} />
			</div>

			<div className="flex justify-end">
				<Button type="submit">save</Button>
			</div>
		</form>
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
