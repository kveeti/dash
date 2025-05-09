import { ReactNode } from "react";

import { api } from "../api";
import { things } from "../things";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useLocaleStuff } from "./use-formatting";

export default function IndexPage() {
	const { formatAmount } = useLocaleStuff();

	const spendingToday = formatAmount(31);
	const spendingThisWeek = formatAmount(126);
	const spendingThisMonth = formatAmount(1003);

	return (
		<div className="mt-12 flex flex-col gap-4">
			<a href={things.apiBase + "/integrations/gocardless-nordigen/connect-init/OP_OKOYFIHH"}>
				connect OP
			</a>

			<NewAccount />

			<Button
				onClick={() =>
					fetch(things.apiBase + "/integrations/sync", {
						method: "POST",
						credentials: "include",
					})
				}
			>
				sync
			</Button>

			<h2>
				<span className="sr-only">spent today</span>
				<span className="text-5xl">
					<Indicator>m</Indicator>
					{spendingThisMonth}
				</span>
			</h2>
			<h2>
				<span className="sr-only">spent today</span>
				<span className="text-gray-12/70 text-5xl">
					<Indicator>w</Indicator>
					{spendingThisWeek}
				</span>
			</h2>
			<h2>
				<span className="sr-only">spent today</span>
				<span className="text-gray-12/50 text-5xl">
					<Indicator>d</Indicator>
					{spendingToday}
				</span>
			</h2>
		</div>
	);
}

function Indicator({ children }: { children: ReactNode }) {
	return (
		<span className="text-4xl opacity-90">
			{children}
			<span className="opacity-40">...</span>
		</span>
	);
}

function NewAccount() {
	const mutation = api.useMutation("post", "/accounts");

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();

		const formData = new FormData(e.currentTarget);
		const name = formData.get("name")?.toString() ?? "";

		mutation.mutateAsync({ body: { name } });
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-2">
			<Input label="name" name="name" />

			<Button type="submit">create</Button>
		</form>
	);
}
