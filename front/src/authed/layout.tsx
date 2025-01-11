import { PlusIcon } from "@radix-ui/react-icons";
import type { ReactNode } from "react";
import { useRoute } from "wouter";

import { cn } from "../lib/utils";
import { Link } from "../ui/link";

export function AuthLayout(props: { children: ReactNode }) {
	return (
		<div className="mx-auto flex max-w-[800px]">
			<Nav />

			<div className="flex w-full justify-center pt-60 sm:p-4">{props.children}</div>
		</div>
	);
}

export function Nav() {
	return (
		<nav className="min-w-[150px] p-4">
			<ul>
				<TransactionsNavRow />

				<li>
					<NavLink href="/transactions/stats">stats</NavLink>
				</li>
				<li>
					<NavLink href="/accounts">accounts</NavLink>
				</li>
				<li>
					<NavLink href="/categories">categories</NavLink>
				</li>
			</ul>
		</nav>
	);
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
	const [isActive] = useRoute(href);

	return (
		<Link className={cn("p-2 hover:bg-gray-a3 block", isActive && "bg-gray-a3")} href={href}>
			{children}
		</Link>
	);
}

function TransactionsNavRow() {
	const [isTransactions] = useRoute("/transactions");
	const [isTransactionsNew] = useRoute("/transactions/new");

	return (
		<li className="relative flex items-stretch">
			<Link
				className={cn(
					"p-2 hover:bg-gray-a3",
					(isTransactions || isTransactionsNew) && "bg-gray-a3"
				)}
				href="/transactions"
			>
				transactions
			</Link>
			<Link
				className={cn(
					"p-2 flex items-center justify-center",
					isTransactionsNew && "bg-gray-a3"
				)}
				href="/transactions/new"
			>
				<PlusIcon />
			</Link>
		</li>
	);
}
