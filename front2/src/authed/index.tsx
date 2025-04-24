import { ReactNode } from "react";
import { useFormatAmount } from "./use-formatting";

export default function IndexPage() {
	const amountFormat = useFormatAmount();

	const spendingToday = amountFormat(31);
	const spendingThisWeek = amountFormat(126);
	const spendingThisMonth = amountFormat(1003);

	return (
		<div className="flex flex-col gap-4 mt-12">
			<h2>
				<span className="sr-only">spent today</span>
				<span className="text-5xl">
					<Indicator>m</Indicator>
					{spendingThisMonth}
				</span>
			</h2>
			<h2>
				<span className="sr-only">spent today</span>
				<span className="text-5xl text-gray-12/70">
					<Indicator>w</Indicator>
					{spendingThisWeek}
				</span>
			</h2>
			<h2>
				<span className="sr-only">spent today</span>
				<span className="text-5xl text-gray-12/50">
					<Indicator>d</Indicator>
					{spendingToday}
				</span>
			</h2>
		</div>
	);
}

function Indicator({ children }: { children: ReactNode }) {
	return (
		<span className="opacity-90 text-4xl">
			{children}
			<span className="opacity-40">...</span>
		</span>
	);
}
