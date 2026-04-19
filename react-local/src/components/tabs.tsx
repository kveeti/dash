import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ComponentProps } from "react";

function cx(base: string, className?: string) {
	return className ? `${base} ${className}` : base;
}

export function TabsRoot(props: ComponentProps<typeof BaseTabs.Root>) {
	const { className, ...rest } = props;
	return <BaseTabs.Root {...rest} className={cx("w-full", className)} />;
}

export function TabsList(props: ComponentProps<typeof BaseTabs.List>) {
	const { className, ...rest } = props;
	return (
		<BaseTabs.List
			{...rest}
			className={cx(
				"inline-flex items-center gap-2 border border-gray-a4 bg-gray-1 p-1",
				className,
			)}
		/>
	);
}

export function TabsTab(props: ComponentProps<typeof BaseTabs.Tab>) {
	const { className, ...rest } = props;
	return (
		<BaseTabs.Tab
			{...rest}
			className={cx(
				"border border-transparent px-3 py-1 text-xs font-mono text-gray-11 outline-none transition-colors data-[active]:border-gray-8 data-[active]:bg-gray-a3 data-[active]:text-gray-12",
				className,
			)}
		/>
	);
}

export function TabsPanel(props: ComponentProps<typeof BaseTabs.Panel>) {
	const { className, ...rest } = props;
	return <BaseTabs.Panel {...rest} className={cx("pt-4", className)} />;
}
