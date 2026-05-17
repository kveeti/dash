import type { InputHTMLAttributes } from "react";

const base = "field w-full text-[13px]";

const sizes = {
	sm: "h-7 text-[12px] px-2.5",
	default: "h-8 px-2.5",
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
