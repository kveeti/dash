import type { TextareaHTMLAttributes } from "react";

const base = "field w-full text-[13px]";

const sizes = {
	sm: "text-[12px] px-2.5 py-1.5",
	default: "px-2.5 py-2",
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
			<label className="field-label">{label}</label>
			<textarea {...props} className={cls} />
		</div>
	);
}
