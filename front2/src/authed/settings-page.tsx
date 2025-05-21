import { FormEvent } from "react";

import { api } from "../api";

function useSaveSettings() {
	return api.useMutation("post", "/settings");
}

export default function SettingsPage() {
	const mutation = useSaveSettings();

	function onSave(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (mutation.isPending) return;

		const form = e.currentTarget;
		const locale = form.locale.value;

		mutation
			.mutateAsync({ body: { locale } })
			.then(setMe)
			.catch(errorToast("error saving settings"));
	}

	return (
		<div className="flex w-full max-w-sm flex-col gap-6">
			<form className="space-y-4" onSubmit={onSave}>
				<h1>settings</h1>

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
