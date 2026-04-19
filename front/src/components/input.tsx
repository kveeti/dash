import type { InputHTMLAttributes } from "react";

const base = "focus border-gray-6 bg-gray-1 border px-3 w-full";

const sizes = {
	sm: "h-8 text-sm px-2",
	default: "h-10",
};

export function Input({
	label,
	size = "default",
	className,
	...props
}: InputHTMLAttributes<HTMLInputElement> & {
	label?: string;
	size?: keyof typeof sizes;
}) {
	let cls = base + " " + sizes[size];
	if (className) cls += " " + className;

	if (!label) return <input {...props} className={cls} />;

	return (
		<div>
			<label className="text-gray-11 mb-1 block text-xs">{label}</label>
			<input {...props} className={cls} />
		</div>
	);
}
