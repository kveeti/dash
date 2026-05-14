import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCreateTagMutation } from "../lib/queries/tags";
import { IconCross } from "./icons/cross";
import { IconPlus } from "./icons/plus";
import { PopupCombobox, PopupComboboxTrigger } from "./popup-combobox";

type TagItem = {
	id: string;
	name: string;
	creatable?: string;
};

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
		<PopupComboboxTrigger<TagItem[]>
			nativeButton={false}
			size={size}
			className={
				"flex !h-auto w-full min-w-0 items-center gap-1.5 py-1 " +
				(className ? ` ${className}` : "")
			}
		>
			{(selectedItems) => (
				<>
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
						{selectedItems.length ? (
							selectedItems.map((tag) => (
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
		</PopupComboboxTrigger>
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
	creatable = false,
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
	const [optimisticItems, setOptimisticItems] = useState<TagItem[]>([]);
	const displayItems = useMemo(() => {
		const existingIds = new Set(items.map((item) => item.id));
		return [
			...items,
			...optimisticItems.filter((item) => !existingIds.has(item.id)),
		];
	}, [items, optimisticItems]);
	const selectedItems = useMemo(
		() => displayItems.filter((item) => value.includes(item.id)),
		[displayItems, value],
	);
	const uniqueNextValue = (nextId: string) =>
		Array.from(new Set([...value, nextId]));
	const removeValue = (tagId: string) =>
		onChange(value.filter((selectedId) => selectedId !== tagId));

	useEffect(() => {
		if (!optimisticItems.length) return;
		const resolvedIds = new Set(items.map((item) => item.id));
		setOptimisticItems((prev) =>
			prev.filter((item) => value.includes(item.id) && !resolvedIds.has(item.id)),
		);
	}, [items, optimisticItems.length, value]);

	return (
		<PopupCombobox
			multiple
			items={displayItems}
			value={selectedItems}
			onValueChange={(next) => onChange(next.map((item) => item.id))}
			getItemKey={(item) => item.id}
			renderItem={(item) =>
				item.creatable ? (
					<div className="flex w-full items-center justify-between gap-2">
						<span className="truncate">Create "{item.creatable}"</span>
						<span className="text-xs text-gray-10">new</span>
					</div>
				) : (
					<span className="truncate">{item.name}</span>
				)
			}
			itemToStringLabel={(item) => item.name}
			isItemEqualToValue={(item, selected) => item.id === selected.id}
			creatable={
				creatable
					? {
							createItem: (rawQuery) => ({
								id: `create:${rawQuery.toLocaleLowerCase()}`,
								name: `Create "${rawQuery}"`,
								creatable: rawQuery,
							}),
							isCreateItem: (item) => Boolean(item.creatable),
							isExistingItemMatch: (item, normalizedQuery) =>
								item.name.trim().toLocaleLowerCase() === normalizedQuery,
							onCreateRequest: async (rawQuery) => {
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
									setOptimisticItems((prev) => [...prev, { id: newId, name }]);
									await onChange(uniqueNextValue(newId));
								} finally {
									creatingRef.current = false;
								}
							},
							getCreateQuery: (item) => item.creatable ?? "",
						}
					: undefined
			}
			placeholder={placeholder}
			inputPlaceholder="search tags..."
			size={size}
			disabled={disabled}
			emptyState={<p className="p-2 text-gray-10">No tags found.</p>}
		>
			<TagMultiComboboxTrigger
				className={className}
				disabled={disabled}
				onRemove={removeValue}
				placeholder={placeholder}
				size={size}
			/>
		</PopupCombobox>
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
