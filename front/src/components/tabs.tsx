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
				"relative inline-flex items-center gap-1 border-b border-gray-a3",
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
				"relative h-8 px-3 text-[13px] text-gray-11 outline-none transition-colors hover:text-gray-12 data-[active]:text-gray-12 after:absolute after:left-0 after:right-0 after:-bottom-px after:h-px after:bg-transparent data-[active]:after:bg-gray-12 focus-visible:bg-gray-a3 rounded-t-md",
				className,
			)}
		/>
	);
}

export function TabsPanel(props: ComponentProps<typeof BaseTabs.Panel>) {
	const { className, ...rest } = props;
	return <BaseTabs.Panel {...rest} className={cx("pt-6", className)} />;
}
