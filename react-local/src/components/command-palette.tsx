import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog } from "@base-ui/react/dialog";
import { ScrollArea } from "@base-ui/react/scroll-area";

interface Item {
	value: string;
	label: string;
	href: string;
}

interface Group {
	value: string;
	items: Item[];
}

const pages: Item[] = [
	{ value: "stats", label: "Stats", href: "/stats" },
	{ value: "txs", label: "Transactions", href: "/txs" },
	{ value: "txs-new", label: "Add Transactions", href: "/txs/new" },
	{ value: "cats", label: "Categories", href: "/cats" },
	{ value: "settings", label: "Settings", href: "/settings" },
];

const groupedItems: Group[] = [{ value: "Pages", items: pages }];

export function CommandPalette() {
	const [open, setOpen] = useState(false);
	const [, setLocation] = useLocation();

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				setOpen((prev) => !prev);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	function navigate(item: Item) {
		setLocation(item.href);
		setOpen(false);
	}

	return (
		<Dialog.Root open={open} onOpenChange={setOpen}>
			<Dialog.Portal>
				<Dialog.Backdrop className="bg-gray-a4 dark:bg-black-a5 fixed inset-0 backdrop-blur-xs" />
				<Dialog.Viewport className="fixed inset-0 flex items-start justify-center overflow-hidden px-2 pt-18 pb-2">
					<Dialog.Popup
						className="bg-gray-1 border-gray-a5 flex max-h-[min(36rem,calc(100dvh-5rem))] w-[calc(100vw-1rem)] max-w-[28rem] flex-col overflow-hidden border font-mono"
						aria-label="Command palette"
					>
						<Autocomplete.Root
							open
							inline
							items={groupedItems}
							autoHighlight="always"
							keepHighlight
						>
							<Autocomplete.Input
								className="border-gray-a4 w-full border-0 border-b bg-transparent p-3 text-sm outline-none placeholder:text-gray-9"
								placeholder="Go to..."
							/>
							<Dialog.Close className="sr-only">Close</Dialog.Close>

							<ScrollArea.Root className="relative flex max-h-[min(60dvh,24rem)] min-h-0 flex-[0_1_auto] overflow-hidden">
								<ScrollArea.Viewport className="min-h-0 flex-1 overscroll-contain">
									<ScrollArea.Content style={{ minWidth: "100%" }}>
										<Autocomplete.Empty className="flex min-h-24 items-center justify-center p-4 text-sm text-gray-9 empty:m-0 empty:min-h-0 empty:p-0">
											No results.
										</Autocomplete.Empty>

										<Autocomplete.List className="p-1">
											{(group: Group) => (
												<Autocomplete.Group
													key={group.value}
													items={group.items}
												>
													<Autocomplete.GroupLabel className="flex h-7 items-center px-2 text-xs text-gray-9 select-none">
														{group.value}
													</Autocomplete.GroupLabel>
													<Autocomplete.Collection>
														{(item: Item) => (
															<Autocomplete.Item
																key={item.value}
																value={item}
																onClick={() => navigate(item)}
																className="flex h-8 cursor-default items-center gap-2 px-2 text-sm select-none outline-none data-[highlighted]:bg-gray-a3"
															>
																<span className="truncate">{item.label}</span>
																<span className="ml-auto text-xs text-gray-9">
																	{item.href}
																</span>
															</Autocomplete.Item>
														)}
													</Autocomplete.Collection>
												</Autocomplete.Group>
											)}
										</Autocomplete.List>
									</ScrollArea.Content>
								</ScrollArea.Viewport>
								<ScrollArea.Scrollbar className="flex w-4 justify-center py-1">
									<ScrollArea.Thumb className="flex w-full justify-center before:block before:h-full before:w-1 before:rounded-sm before:bg-gray-7 before:content-['']" />
								</ScrollArea.Scrollbar>
							</ScrollArea.Root>

							<div className="border-gray-a4 flex items-center gap-3 border-t px-3 py-2 text-xs text-gray-9">
								<span>Navigate</span>
								<kbd className="border-gray-a5 bg-gray-a2 inline-flex h-5 min-w-5 items-center justify-center border px-1 text-[0.625rem]">
									Enter
								</kbd>
							</div>
						</Autocomplete.Root>
					</Dialog.Popup>
				</Dialog.Viewport>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
