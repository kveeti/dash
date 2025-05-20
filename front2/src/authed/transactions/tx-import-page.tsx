import * as ak from "@ariakit/react";
import { useMutation } from "@tanstack/react-query";
import { ChangeEvent, FormEvent, startTransition, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { errorToast } from "../../lib/error-toast";
import { things } from "../../things";
import { Button } from "../../ui/button";
import { IconChevronsUpDown } from "../../ui/icons/chevrons-up-down";
import { Label, LabelWrapper, Error as _Error, labelStyles } from "../../ui/input";
import { AccountField, CreateAccount, SelectComboItem } from "./new-tx-page";

const fileTypes = ["op", "generic"];

export default function TxImportPage() {
	const mutation = useMutation({
		mutationFn: doImport,
	});

	function handleSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();

		const data = new FormData(e.currentTarget);
		const accountId = data.get("accountId") as string;
		data.delete("accountId");
		const fileType = data.get("fileType") as string;
		data.delete("fileType");

		mutation
			.mutateAsync({
				account_id: accountId,
				file_type: fileType,
				formData: data,
			})
			.then((res) => toast.success(`uploaded ${res.rows} rows`))
			.catch(errorToast("error uploading transactions"));
	}

	return (
		<>
			<form onSubmit={handleSubmit} className="w-full max-w-xs space-y-6">
				<div className="flex items-end gap-3">
					<AccountField name="accountId" label="account" />

					<CreateAccount />
				</div>

				<FileTypeField name="fileType" label="file type" defaultValue="op" />

				<FileField name="file" label="file" />

				<div className="mt-4 flex justify-end">
					<Button type="submit" isLoading={mutation.isPending}>
						import
					</Button>
				</div>
			</form>
		</>
	);
}

function FileTypeField({
	name,
	label,
	error,
	defaultValue,
}: {
	label: string;
	name: string;
	error?: string;
	defaultValue?: string;
}) {
	const [searchValue, setSearchValue] = useState("");

	const matches = useMemo(() => {
		return fileTypes.filter((x) => x.includes(searchValue));
	}, [searchValue]);

	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	const parent = useRef<HTMLDivElement | null>(null);

	return (
		<div ref={parent}>
			<ak.ComboboxProvider
				resetValueOnHide
				setValue={(value) => {
					startTransition(() => {
						setSearchValue(value);
					});
				}}
			>
				<ak.SelectProvider defaultValue={defaultValue}>
					<LabelWrapper>
						<ak.SelectLabel className={labelStyles}>{label}</ak.SelectLabel>

						{error && errorId && <_Error id={errorId}>{error}</_Error>}
					</LabelWrapper>

					<ak.Select
						name={name}
						className={
							"focus border-gray-6 flex h-10 w-full items-center justify-between border"
						}
					>
						<span className="ps-3">
							<ak.SelectValue />
						</span>

						<IconChevronsUpDown className="text-gray-a11 me-2 size-5" />
					</ak.Select>

					<ak.SelectPopover
						gutter={4}
						sameWidth
						className="bg-gray-1 border-gray-4 z-10 min-w-(--popover-anchor-width) border outline-hidden"
					>
						<ak.Combobox
							className="border-gray-a4 w-full border-b px-3 py-2 outline-hidden"
							autoSelect
							placeholder="select a file type"
						/>

						<ak.ComboboxList>
							{matches.map((x) => (
								<SelectComboItem key={x} value={x} />
							))}
						</ak.ComboboxList>
					</ak.SelectPopover>
				</ak.SelectProvider>
			</ak.ComboboxProvider>
		</div>
	);
}

function FileField({
	name,
	label,
	error,
}: {
	label: string;
	name: string;
	error?: string;
	defaultValue?: string;
}) {
	const ref = useRef<HTMLInputElement>(null);

	const [selectedFilename, setSelectedFilename] = useState<string | null>(null);

	function onChange(e: ChangeEvent<HTMLInputElement>) {
		const files = e.target.files;
		const firstFile = files?.item(0);
		if (!firstFile) return;

		setSelectedFilename(firstFile.name);
	}

	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	return (
		<div>
			<LabelWrapper>
				<Label>{label}</Label>

				{error && errorId && <_Error id={errorId}>{error}</_Error>}
			</LabelWrapper>

			<button
				type="button"
				className="focus border-gray-a6 inline-flex h-10 w-full items-center justify-start border px-3"
				onClick={() => {
					ref.current?.click();
				}}
			>
				{selectedFilename ? selectedFilename : "select file to import"}
			</button>

			<input
				ref={ref}
				name={name}
				type="file"
				accept="text/csv"
				multiple={false}
				className="hidden"
				onChange={onChange}
			/>
		</div>
	);
}

async function doImport({
	formData,
	file_type,
	account_id,
}: {
	formData: FormData;
	account_id: string;
	file_type: string;
}) {
	return api<{ rows: number }>("/transactions/import" + "/" + account_id + "/" + file_type, {
		method: "POST",
		body: formData,
	});
}

export type ApiError = {
	error: {
		message: string;
	};
};

type Props = {
	method: string;
	body?: unknown;
	query?: Record<string, string>;
	signal?: AbortSignal;
};

export async function api<TReturnValue>(path: string, props: Props) {
	const fetchProps = {
		credentials: "include",
		signal: props.signal,
		method: props.method ?? "GET",
	} as RequestInit;

	if (props.body) {
		if (props.body instanceof FormData) {
			fetchProps.body = props.body;
		} else {
			fetchProps.body = JSON.stringify(props.body);
			fetchProps.headers = { "Content-Type": "application/json" };
		}
	}

	return fetch(
		things.apiBase + path + (props.query ? "?" + new URLSearchParams(props.query) : ""),
		fetchProps
	)
		.then(async (res) => {
			const json = await res.json().catch(() => null);

			if (res.ok) {
				return json as TReturnValue;
			} else {
				throw new Error(json?.error ?? `unexpected server error - status: ${res.status}`);
			}
		})
		.catch(() => {
			throw new Error("network error");
		});
}
