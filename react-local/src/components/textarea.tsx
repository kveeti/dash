import type { TextareaHTMLAttributes } from "react";

const base = "focus border-gray-6 bg-gray-1 border px-3 py-2";

const sizes = {
	sm: "text-sm px-2 py-1",
	default: "",
};

export function Textarea({
	label,
	size = "default",
	className,
	...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
	label?: string;
	size?: keyof typeof sizes;
}) {
	let cls = base + " " + sizes[size];
	if (className) cls += " " + className;

	if (!label) return <textarea {...props} className={cls} />;

	return (
		<div>
			<label className="text-gray-11 mb-1 block text-xs">{label}</label>
			<textarea {...props} className={cls} />
		</div>
	);
}
