import * as ak from "@ariakit/react";
import { FormEvent, startTransition, useMemo, useState } from "react";

import { api, useMe, useSetMe } from "../api";
import { errorToast } from "../lib/error-toast";
import { Button } from "../ui/button";
import { LabelWrapper, inputStyles, labelStyles } from "../ui/input";
import { Heading } from "../ui/typography";
import { useLocaleStuff } from "./use-formatting";

function useSaveSettings() {
	return api.useMutation("post", "/settings");
}

export default function SettingsPage() {
	const mutation = useSaveSettings();
	const me = useMe();
	const setMe = useSetMe();

	function onSave(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (mutation.isPending) return;

		const form = e.currentTarget;
		const locale = form.locale.value;
		const timezone = form.timezone.value;

		mutation
			.mutateAsync({ body: { locale, timezone } })
			.then(() => {
				setMe({ ...me, settings: { locale, timezone } });
			})
			.catch(errorToast("error saving settings"));
	}

	return (
		<div className="flex w-full max-w-xs flex-col gap-6">
			<form className="space-y-4" onSubmit={onSave}>
				<Heading>settings</Heading>

				<LocaleField
					name="locale"
					label="locale"
					defaultValue={me?.settings?.locale ?? undefined}
				/>
				<TimezoneField
					name="timezone"
					label="timezone"
					defaultValue={me?.settings?.timezone ?? undefined}
				/>

				<div className="flex justify-end">
					<Button type="submit" isLoading={mutation.isPending}>
						save
					</Button>
				</div>
			</form>
		</div>
	);
}

const locales = ["fi", "en"];

function LocaleField({
	name,
	label,
	defaultValue,
}: {
	label: string;
	name: string;
	defaultValue?: string;
}) {
	const { locale } = useLocaleStuff();

	const [searchValue, setSearchValue] = useState("");

	const matches = useMemo(() => {
		return locales.filter((x) =>
			x.toLocaleLowerCase().includes(searchValue.toLocaleLowerCase())
		);
	}, [searchValue]);

	return (
		<ak.ComboboxProvider
			defaultValue={defaultValue}
			setValue={(value) => {
				startTransition(() => {
					setSearchValue(value);
				});
			}}
		>
			<LabelWrapper>
				<ak.ComboboxLabel className={labelStyles}>{label}</ak.ComboboxLabel>
			</LabelWrapper>

			<ak.Combobox
				name={name}
				className={inputStyles}
				autoSelect
				autoComplete="both"
				placeholder={`"${locale}"`}
			/>

			<ak.ComboboxPopover
				gutter={4}
				sameWidth
				className="bg-gray-1 border-gray-4 z-10 min-w-(--popover-anchor-width) border outline-hidden"
			>
				{matches.map((x) => (
					<ak.ComboboxItem
						key={x}
						value={x}
						className="data-active-item:bg-gray-a4 flex items-center gap-3 p-2"
					>
						{x}
					</ak.ComboboxItem>
				))}
			</ak.ComboboxPopover>
		</ak.ComboboxProvider>
	);
}

const timezones = ["Europe/Helsinki"];

function TimezoneField({
	name,
	label,
	defaultValue,
}: {
	label: string;
	name: string;
	defaultValue?: string;
}) {
	const { timeZone } = useLocaleStuff();

	const [searchValue, setSearchValue] = useState("");

	const matches = useMemo(() => {
		return timezones.filter((x) =>
			x.toLocaleLowerCase().includes(searchValue.toLocaleLowerCase())
		);
	}, [searchValue]);

	return (
		<ak.ComboboxProvider
			defaultValue={defaultValue}
			setValue={(value) => {
				startTransition(() => {
					setSearchValue(value);
				});
			}}
		>
			<LabelWrapper>
				<ak.ComboboxLabel className={labelStyles}>{label}</ak.ComboboxLabel>
			</LabelWrapper>

			<ak.Combobox
				name={name}
				className={inputStyles}
				autoSelect
				autoComplete="both"
				placeholder={`"${timeZone}"`}
			/>

			<ak.ComboboxPopover
				gutter={4}
				sameWidth
				className="bg-gray-1 border-gray-4 z-10 min-w-(--popover-anchor-width) border outline-hidden"
			>
				{matches.map((x) => (
					<ak.ComboboxItem
						key={x}
						value={x}
						className="data-active-item:bg-gray-a4 flex items-center gap-3 p-2"
					>
						{x}
					</ak.ComboboxItem>
				))}
			</ak.ComboboxPopover>
		</ak.ComboboxProvider>
	);
}
