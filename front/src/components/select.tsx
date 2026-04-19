import type { ReactNode, SelectHTMLAttributes } from "react";

const base = "focus border-gray-6 bg-gray-1 border px-2";

const sizes = {
	sm: "h-8 text-sm px-1",
	default: "h-10",
};

export function Select({
	label,
	size = "default",
	className,
	children,
	...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
	label?: string;
	size?: keyof typeof sizes;
	children: ReactNode;
}) {
	let cls = base + " " + sizes[size];
	if (className) cls += " " + className;

	if (!label) return <select {...props} className={cls}>{children}</select>;

	return (
		<div>
			<label className="text-gray-11 mb-1 block text-xs">{label}</label>
			<select {...props} className={cls}>{children}</select>
		</div>
	);
}
