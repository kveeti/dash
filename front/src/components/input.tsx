import type { InputHTMLAttributes } from "react";

const base = "field w-full";

const sizes = {
	sm: "h-8 text-sm px-2.5",
	default: "h-10 px-3",
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
			<label className="field-label">{label}</label>
			<input {...props} className={cls} />
		</div>
	);
}
