import type { ButtonHTMLAttributes } from "react";

const base =
	"focus relative text-xs inline-flex shrink-0 items-center justify-center whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-40";

const variants = {
	primary: "bg-gray-12 text-gray-1 font-bold",
	outline: "border-gray-a5 border",
	ghost: "text-gray-11 hover:bg-gray-a3",
	destructive: "text-red-11 hover:bg-red-a3",
};

const sizes = {
	sm: "h-8 px-3",
	default: "h-10 px-4",
	icon: "size-10",
};

export function Button({
	variant = "primary",
	size = "default",
	className,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: keyof typeof variants;
	size?: keyof typeof sizes;
}) {
	let cls = base + " " + variants[variant] + " " + sizes[size];
	if (className) cls += " " + className;

	return <button {...props} className={cls} />;
}
