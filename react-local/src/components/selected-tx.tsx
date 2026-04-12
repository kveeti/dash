import { useRef, useState, useEffect, type ReactNode } from "react";
import { IconDragHandleDots1 } from "./icons/drag-handle-dots-1";

type DragOffset = { x: number; y: number };


type SelectedTxProps = {
	id: string;
	label: string;
	onClose: () => void;
	initialOffset?: DragOffset;
	children: ReactNode;
};

export function SelectedTx({ id, label, onClose, initialOffset, children }: SelectedTxProps) {
	const [offset, setOffset] = useState<DragOffset>(initialOffset ?? { x: 0, y: 0 });
	const dragStart = useRef<{ mouseX: number; mouseY: number; offsetX: number; offsetY: number } | null>(null);

	useEffect(() => {
		const handleMove = (e: PointerEvent) => {
			if (!dragStart.current) return;
			const dx = e.clientX - dragStart.current.mouseX;
			const dy = e.clientY - dragStart.current.mouseY;
			setOffset({
				x: dragStart.current.offsetX + dx,
				y: dragStart.current.offsetY + dy,
			});
		};
		const handleUp = () => {
			if (dragStart.current) {
				dragStart.current = null;
			}
		};
		document.addEventListener("pointermove", handleMove);
		document.addEventListener("pointerup", handleUp);
		return () => {
			document.removeEventListener("pointermove", handleMove);
			document.removeEventListener("pointerup", handleUp);
		};
	}, [id, offset]);

	return (
		<section
			aria-label={label}
			className="fixed max-h-[85vh] w-[90vw] max-w-[24rem] shadow-lg"
			style={{
				top: `calc(2.3rem + ${offset.y}px)`,
				left: `calc(100vw - 24rem - 1.2rem + ${offset.x}px)`,
			}}
		>
			<div
				className="cursor-grab active:cursor-grabbing select-none flex items-center justify-between bg-gray-3 px-3 py-2 border border-gray-a3 rounded-t-sm"
				onPointerDown={(e) => {
					dragStart.current = {
						mouseX: e.clientX,
						mouseY: e.clientY,
						offsetX: offset.x,
						offsetY: offset.y,
					};
				}}
			>
				<span className="flex items-center gap-2 text-xs text-gray-11 rounded-t-sm">
					<IconDragHandleDots1 className="text-gray-10" />
					transaction
				</span>
				<button
					type="button"
					onClick={onClose}
					className="rounded p-1 hover:bg-gray-a3 text-gray-11 hover:text-gray-12"
					aria-label="Close"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>
			<div className="border-b border-x border-gray-a4 bg-gray-1">
				{children}
			</div>
		</section>
	);
}
