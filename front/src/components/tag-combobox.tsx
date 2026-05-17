import type { MouseEvent } from "react";
import { useCallback, useMemo, useRef } from "react";
import { useCreateTagMutation } from "../lib/queries/tags";
import { Combobox } from "./combobox";
import { IconCheck } from "./icons/check";
import { IconCross } from "./icons/cross";
import { IconPlus } from "./icons/plus";
import { useTransientOptions } from "./use-transient-options";

type TagItem = {
	id: string;
	name: string;
	creatable?: string;
};

function tagItemKey(item: TagItem) {
	return item.id;
}

function TagMultiComboboxTrigger({
	className,
	disabled,
	onRemove,
	placeholder,
	size,
}: {
	className?: string;
	disabled?: boolean;
	onRemove: (tagId: string) => void | Promise<void>;
	placeholder: string;
	size: "sm" | "default";
}) {
	const handleRemove = (
		event: MouseEvent<HTMLButtonElement>,
		tagId: string,
	) => {
		event.preventDefault();
		event.stopPropagation();
		if (disabled) return;
		void onRemove(tagId);
	};

	const handleRemoveMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	return (
		<Combobox.Trigger<TagItem, TagItem[]>
			nativeButton={false}
			render={<div />}
			className={
				"focus field-trigger data-[disabled]:opacity-60 flex h-auto w-full min-w-0 items-center gap-1.5 overflow-hidden py-1 " +
				(size === "sm" ? "px-2 text-sm" : "px-3 text-sm") +
				(className ? ` ${className}` : "")
			}
		>
			{({ selectedValue }) => (
				<>
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
						{selectedValue.length ? (
							selectedValue.map((tag) => (
								<button
									key={tag.id}
									type="button"
									disabled={disabled}
									className="inline-flex h-5 max-w-[10rem] items-center gap-1 bg-gray-a3 px-1.5 text-xs text-gray-12 outline-none hover:bg-gray-a5 focus-visible:ring-1 focus-visible:ring-gray-a7 disabled:pointer-events-none"
									aria-label={`Remove ${tag.name}`}
									onMouseDown={handleRemoveMouseDown}
									onClick={(event) => handleRemove(event, tag.id)}
								>
									<span className="truncate">{tag.name}</span>
									<IconCross className="size-3 shrink-0 text-gray-10" />
								</button>
							))
						) : (
							<span className="truncate text-gray-10">{placeholder}</span>
						)}
					</div>
					<span
						className="border-gray-a4 text-gray-10 flex size-5 shrink-0 items-center justify-center border bg-gray-a2"
						aria-hidden
					>
						<IconPlus className="size-3" />
					</span>
				</>
			)}
		</Combobox.Trigger>
	);
}

export function TagMultiCombobox({
	items,
	value,
	onChange,
	placeholder = "filter by tag...",
	size = "default",
	className,
	disabled = false,
	creatable = true,
}: {
	items: TagItem[];
	value: string[];
	onChange: (value: string[]) => void | Promise<void>;
	placeholder?: string;
	size?: "sm" | "default";
	className?: string;
	disabled?: boolean;
	creatable?: boolean;
}) {
	const createTag = useCreateTagMutation();
	const creatingRef = useRef(false);
	const keepTransientItem = useCallback(
		(item: TagItem) => value.includes(item.id),
		[value],
	);
	const tagOptions = useTransientOptions(items, tagItemKey, keepTransientItem);
	const displayItems = tagOptions.options;
	const selectedItems = useMemo(
		() => displayItems.filter((item) => value.includes(item.id)),
		[displayItems, value],
	);
	const uniqueNextValue = (nextId: string) =>
		Array.from(new Set([...value, nextId]));
	const removeValue = (tagId: string) =>
		onChange(value.filter((selectedId) => selectedId !== tagId));

	return (
		<Combobox.Root
			multiple
			items={displayItems}
			value={selectedItems}
			onValueChange={(next) => onChange(next.map((item) => item.id))}
			itemToStringLabel={(item) => item.name}
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
										item.name.trim().toLocaleLowerCase() ===
										normalizedInputValue,
								);
								if (hasExactMatch) return null;

								return {
									id: `create:${trimmedInputValue.toLocaleLowerCase()}`,
									name: `Create "${trimmedInputValue}"`,
									creatable: trimmedInputValue,
								};
							},
							isItem: (item) => Boolean(item.creatable),
							onRequest: async (rawQuery) => {
								if (creatingRef.current) return;

								const name = rawQuery.trim();
								if (!name) return;

								const existing = displayItems.find(
									(item) =>
										item.name.trim().toLocaleLowerCase() ===
										name.toLocaleLowerCase(),
								);
								if (existing) {
									await onChange(uniqueNextValue(existing.id));
									return;
								}

								creatingRef.current = true;
								try {
									const newId = await createTag.mutateAsync(name);
									tagOptions.add({ id: newId, name });
									await onChange(uniqueNextValue(newId));
								} finally {
									creatingRef.current = false;
								}
							},
							getQuery: (item) => item.creatable ?? "",
						}
					: undefined
			}
			disabled={disabled}
			autoHighlight
		>
			<TagMultiComboboxTrigger
				className={className}
				disabled={disabled}
				onRemove={removeValue}
				placeholder={placeholder}
				size={size}
			/>
			<Combobox.Content
				searchPlaceholder="search tags..."
				empty="No tags found."
				size={size}
			>
				<Combobox.List<TagItem>>
					{(item, index, context) => {
						const selected =
							Array.isArray(context.value) &&
							context.value.some((selectedItem) => selectedItem.id === item.id);

						return (
							<Combobox.Item key={item.id} value={item} size={size} index={index}>
								{!context.isCreateItem(item) && (
									<span
										data-combobox-keep-open
										className="-my-2 -ml-2 mr-0 flex size-9 shrink-0 items-center justify-center text-gray-11"
										aria-hidden
									>
										<span className="border-gray-a5 bg-gray-1 flex size-4 items-center justify-center border">
											{selected && <IconCheck />}
										</span>
									</span>
								)}
								{item.creatable ? (
									<div className="flex w-full items-center justify-between gap-2">
										<span className="truncate">Create "{item.creatable}"</span>
										<span className="text-xs text-gray-10">new</span>
									</div>
								) : (
									<span className="truncate">{item.name}</span>
								)}
							</Combobox.Item>
						);
					}}
				</Combobox.List>
			</Combobox.Content>
		</Combobox.Root>
	);
}

export function TagChips({
	tags,
	onRemove,
}: {
	tags: Array<{ id: string; name: string }>;
	onRemove?: (tagId: string) => void;
}) {
	if (!tags.length) return null;

	return (
		<div className="flex min-w-0 flex-wrap gap-1">
			{tags.map((tag) => (
				<span
					key={tag.id}
					className="inline-flex max-w-full items-center gap-1 border border-gray-a4 px-1.5 text-[11px] leading-5 text-gray-11"
				>
					<span className="truncate">{tag.name}</span>
					{onRemove && (
						<button
							type="button"
							className="text-gray-9 hover:text-gray-12"
							onClick={() => onRemove(tag.id)}
							aria-label={`Remove ${tag.name}`}
						>
							x
						</button>
					)}
				</span>
			))}
		</div>
	);
}
