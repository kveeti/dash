import { useCallback, useMemo, useRef } from "react";
import { useCreateCategoryMutation } from "../lib/queries/categories";
import { IconChevronsUpDown } from "./icons/chevrons-up-down";
import {
	localSearchSource,
	UnstableCombobox,
	type UnstableComboboxConfig,
	type UnstableComboboxItem,
} from "./unstable-combobox";
import { useTransientOptions } from "./use-transient-options";

export type CategoryComboboxItem = {
	id: string;
	value: string;
	label: string;
};

function categoryItemKey(item: CategoryComboboxItem) {
	return item.id;
}

function cx(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(" ");
}

export function CategoryCombobox({
	items,
	value,
	onChange,
	name,
	label,
	required = false,
	size = "default",
	className,
	creatable = false,
	placeholder = "select category...",
}: {
	items: CategoryComboboxItem[];
	value: string;
	onChange: (value: string) => void;
	name?: string;
	label?: string;
	required?: boolean;
	disabled?: boolean;
	size?: "sm" | "default";
	className?: string;
	creatable?: boolean;
	placeholder?: string;
}) {
	const createCategory = useCreateCategoryMutation();
	const creatingRef = useRef(false);
	const keepTransientItem = useCallback(
		(item: CategoryComboboxItem) => item.id === value,
		[value],
	);
	const categoryOptions = useTransientOptions(
		items,
		categoryItemKey,
		keepTransientItem,
	);
	const selectedItem = useMemo(() => {
		return categoryOptions.options.find((item) => item.id === value) ?? null;
	}, [categoryOptions.options, value]);

	const handleCreateCategory = useCallback(
		async (rawName: string) => {
			if (creatingRef.current) return;

			const categoryName = rawName.trim().replace(/\s+/g, " ");
			if (!categoryName) return;

			const existing = categoryOptions.options.find(
				(item) =>
					item.label.trim().toLocaleLowerCase() ===
					categoryName.toLocaleLowerCase(),
			);
			if (existing) {
				onChange(existing.id);
				return;
			}

			creatingRef.current = true;
			try {
				const newId = await createCategory.mutateAsync({
					name: categoryName,
					is_neutral: false,
				});
				categoryOptions.add({
					id: newId,
					value: newId,
					label: categoryName,
				});
				onChange(newId);
			} finally {
				creatingRef.current = false;
			}
		},
		[categoryOptions, createCategory, onChange],
	);

	const config = useMemo<UnstableComboboxConfig>(() => {
		const categoryItems = categoryOptions.options.map<UnstableComboboxItem>(
			(item) => ({
				id: `category:${item.id}`,
				label: item.label,
				textValue: item.label,
				checked: item.id === value,
				onSelect: ({ close }) => {
					onChange(item.id);
					close();
				},
			}),
		);

		return {
			rootPageId: "root",
			pages: {
				root: {
					id: "root",
					title: "category",
					placeholder: "search categories...",
					empty: "No categories found.",
					items: categoryItems,
					search: {
						sources: [
							localSearchSource({ id: "categories", items: categoryItems }),
						],
					},
					queryNodes: creatable
						? [
								{
									id: "create-category",
									placement: "after-results",
									when: ({ query, hasExactMatch }) =>
										query.trim().length > 0 && !hasExactMatch(),
									getNodes: ({ normalizedQuery, query }) => [
										{
											type: "group",
											id: "create-category",
											label: "Create",
											items: [
												{
													id: `category:create:${normalizedQuery}`,
													label: `Create "${query.trim()}"`,
													textValue: query,
													onSelect: ({ close }) => {
														close();
														void handleCreateCategory(query);
													},
												},
											],
										},
									],
								},
							]
						: undefined,
				},
			},
		};
	}, [
		categoryOptions.options,
		creatable,
		handleCreateCategory,
		onChange,
		value,
	]);

	const root = (
		<>
			{name && (
				<input
					type="hidden"
					name={name}
					value={selectedItem?.value ?? ""}
					required={required}
					readOnly
				/>
			)}
			<UnstableCombobox
				config={config}
				trigger={({ open }) => (
					<button
						type="button"
						className={cx(
							"focus field-trigger flex h-9 w-full min-w-0 items-center justify-between gap-2 overflow-hidden pl-2.5 pr-2 text-sm",
							size === "default" && "pl-3 pr-2.5",
							open && "border-gray-a5 bg-gray-a2",
							className,
						)}
					>
						<span className="truncate text-gray-12">
							{selectedItem?.label ?? (
								<span className="text-gray-10">{placeholder}</span>
							)}
						</span>
						<span className="text-gray-10 flex shrink-0">
							<IconChevronsUpDown />
						</span>
					</button>
				)}
			/>
		</>
	);

	if (!label) return root;

	return (
		<div>
			<label className="field-label">{label}</label>
			{root}
		</div>
	);
}
