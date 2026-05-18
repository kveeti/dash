import { Combobox } from "./combobox";
import { IconChevronsUpDown } from "./icons/chevrons-up-down";
import { useCreateCategoryMutation } from "../lib/queries/categories";
import { useCallback, useMemo, useRef } from "react";
import { useTransientOptions } from "./use-transient-options";

export type CategoryComboboxItem = {
	id: string;
	value: string;
	label: string;
	creatable?: string;
};

function categoryItemKey(item: CategoryComboboxItem) {
	return item.id;
}

export function CategoryCombobox({
	items,
	value,
	onChange,
	name,
	label,
	required = false,
	disabled = false,
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

	const root = (
		<Combobox.Root
			items={categoryOptions.options}
			value={selectedItem}
			onValueChange={(next) => {
				onChange(next?.id ?? "");
			}}
			itemToStringLabel={(item) => item.label}
			isItemEqualToValue={(item, selected) => item.id === selected.id}
			create={
				creatable
					? {
							getItem: ({
								items,
								normalizedInputValue,
								trimmedInputValue,
							}) => {
								if (!trimmedInputValue) return null;

								const hasExactMatch = items.some(
									(item) =>
										item.label.trim().toLocaleLowerCase() ===
										normalizedInputValue,
								);
								if (hasExactMatch) return null;

								return {
									id: `create:${trimmedInputValue.toLocaleLowerCase()}`,
									value: `create:${trimmedInputValue.toLocaleLowerCase()}`,
									label: `Create "${trimmedInputValue}"`,
									creatable: trimmedInputValue,
								};
							},
							isItem: (item) => Boolean(item.creatable),
							onRequest: async (rawQuery) => {
								if (creatingRef.current) return;

								const name = rawQuery.trim();
								if (!name) return;

								const existing = categoryOptions.options.find(
									(item) =>
										item.label.trim().toLocaleLowerCase() ===
										name.toLocaleLowerCase(),
								);
								if (existing) {
									onChange(existing.id);
									return;
								}

								creatingRef.current = true;
								try {
									const newId = await createCategory.mutateAsync({
										name,
										is_neutral: false,
									});
									categoryOptions.add({
										id: newId,
										value: newId,
										label: name,
									});
									onChange(newId);
								} finally {
									creatingRef.current = false;
								}
							},
							getQuery: (item) => item.creatable ?? "",
						}
					: undefined
			}
			name={name}
			required={required}
			disabled={disabled}
			autoHighlight
		>
			<Combobox.Trigger<CategoryComboboxItem, CategoryComboboxItem | null>
				className={
					"focus field-trigger data-[disabled]:opacity-60 flex h-9 w-full min-w-0 items-center justify-between gap-2 overflow-hidden pl-2.5 pr-2 text-sm" +
					(className ? ` ${className}` : "")
				}
			>
				{({ selectedValue }) => (
					<>
						<span className="truncate text-gray-12">
							{selectedValue?.label ?? (
								<span className="text-gray-10">{placeholder}</span>
							)}
						</span>
						<Combobox.Icon className="text-gray-10 flex shrink-0">
							<IconChevronsUpDown />
						</Combobox.Icon>
					</>
				)}
			</Combobox.Trigger>
			<Combobox.Content
				searchPlaceholder="search categories..."
				empty="No categories found."
				size={size}
			>
				<Combobox.List<CategoryComboboxItem>>
					{(item) => (
						<Combobox.Item key={item.id} value={item} size={size}>
							{item.creatable ? (
								<div className="flex w-full items-center justify-between gap-2">
									<span className="truncate">Create "{item.creatable}"</span>
									<span className="text-xs text-gray-10">new</span>
								</div>
							) : (
								<div className="flex w-full items-center justify-between gap-2">
									<span className="truncate">{item.label}</span>
								</div>
							)}
						</Combobox.Item>
					)}
				</Combobox.List>
			</Combobox.Content>
		</Combobox.Root>
	);

	if (!label) return root;

	return (
		<div>
			<label className="field-label">{label}</label>
			{root}
		</div>
	);
}
