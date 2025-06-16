import * as ak from "@ariakit/react";
import { useQueryClient } from "@tanstack/react-query";
import { Tooltip } from "radix-ui";
import { FormEvent, startTransition, useMemo, useState } from "react";

import { api, useMe, useSetMe } from "../api";
import { errorToast } from "../lib/error-toast";
import { things } from "../things";
import { Button } from "../ui/button";
import { IconCross } from "../ui/icons/cross";
import { LabelWrapper, inputStyles, labelStyles } from "../ui/input";
import { textLinkStyles } from "../ui/link";
import { Spinner } from "../ui/spinner";
import { TooltipContent } from "../ui/tooltip";
import { Heading } from "../ui/typography";
import { useLocaleStuff } from "./use-formatting";

function useSaveSettings() {
	return api.useMutation("post", "/v1/settings");
}

function useSync() {
	return api.useMutation("post", "/v1/integrations/sync");
}

function useDeleteConnectedIntegration() {
	const qc = useQueryClient();
	return api.useMutation("delete", "/v1/integrations/{integration_name}", {
		onSuccess: () => {
			qc.invalidateQueries(api.queryOptions("get", "/v1/integrations"));
		},
	});
}

function useGetIntegrations() {
	return api.useQuery("get", "/v1/integrations");
}

export default function SettingsPage() {
	const mutation = useSaveSettings();
	const me = useMe();
	const setMe = useSetMe();
	const integrations = useGetIntegrations();

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

			<div className="space-y-4">
				<div className="mt-6 flex items-center justify-between gap-3">
					<Heading level={2}>integrations</Heading>

					{!!integrations.data?.connected.length && <SyncButton />}
				</div>

				{integrations.isLoading ? (
					<div className="flex h-10 items-center justify-center">
						<Spinner />
					</div>
				) : (
					<>
						{!!integrations.data?.connected.length && (
							<div>
								<h3 className="mb-1 font-medium">connected</h3>
								<ul>
									{integrations.data?.connected.map((c) => (
										<ConnectedIntegration integration={c} />
									))}
								</ul>
							</div>
						)}

						{!!integrations.data?.available.length && (
							<div>
								<h3 className="mb-1 font-medium">available</h3>
								<ul>
									{integrations.data?.available.map((c) => (
										<li>
											<a
												className={textLinkStyles}
												href={things.apiBase + c.link}
											>
												{c.label}
											</a>
										</li>
									))}
								</ul>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}

function ConnectedIntegration({ integration }: { integration: { name: string; label: string } }) {
	const mutation = useDeleteConnectedIntegration();

	function handleClick() {
		if (mutation.isPending) return;

		mutation
			.mutateAsync({ params: { path: { integration_name: integration.name } } })
			.catch(errorToast("error deleting integration"));
	}

	return (
		<li className="flex items-center gap-2">
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<Button
						isLoading={mutation.isPending}
						variant="ghost"
						size="icon"
						onClick={handleClick}
					>
						<IconCross />
					</Button>
				</Tooltip.Trigger>
				<TooltipContent>delete</TooltipContent>
			</Tooltip.Root>
			{integration.label}
		</li>
	);
}

function SyncButton() {
	const mutation = useSync();

	return (
		<Button
			variant="ghost"
			isLoading={mutation.isPending}
			onClick={() => {
				mutation.mutateAsync({}).catch(errorToast("error triggering sync"));
			}}
		>
			sync
		</Button>
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
