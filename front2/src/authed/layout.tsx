import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import { type ReactNode } from "react";
import { useRoute } from "wouter";

import { Button } from "../ui/button";
import * as Dropdown from "../ui/dropdown";
import { FastLink, SlowLink } from "../ui/link";

export default function AuthLayout(props: { children: ReactNode }) {
	return (
		<div className="relative mx-auto flex max-w-[800px]">
			<div className="z-10">
				<Nav />
			</div>

			<div className="flex w-full justify-center p-1 pt-50 pb-50 sm:p-4 sm:pt-20">
				{props.children}
			</div>
		</div>
	);
}

export function Nav() {
	return (
		<nav
			className={
				" bg-gray-1 right-0 left-0 flex h-10 items-center shadow-xs sm:top-0 sm:border-t-0 sm:border-b" +
				" pwa:pb-10 pwa:sm:pb-0 border-gray-a4 fixed bottom-0 h-max border-t px-4 shadow-xs" +
				" me-(--removed-body-scroll-bar-size)"
			}
		>
			<ul className="mx-auto flex w-full max-w-[800px] justify-between">
				<div className="flex">
					<li>
						<NavLink href="/">home</NavLink>
					</li>
					<li>
						<NavLink href="/transactions/stats">stats</NavLink>
					</li>
					<li>
						<NavLink href="/transactions">txs</NavLink>
					</li>
					<li>
						<NavLink href="/categories">cats</NavLink>
					</li>
				</div>

				<Hamburger />
			</ul>
		</nav>
	);
}

function Transactions() {
	return (
		<Dropdown.Root>
			<Dropdown.Trigger className="focus hover:bg-gray-a3 size-10 px-2 -outline-offset-2">
				tx
			</Dropdown.Trigger>
			<Dropdown.Content>
				<Dropdown.Item asChild>
					<SlowLink href="/transactions">transactions</SlowLink>
				</Dropdown.Item>
				<Dropdown.Item asChild>
					<SlowLink href="/transactions/new">new tx</SlowLink>
				</Dropdown.Item>
				<Dropdown.Item asChild>
					<SlowLink href="/transactions/import">import</SlowLink>
				</Dropdown.Item>
				<Dropdown.Item asChild>
					<SlowLink href="/categories">categories</SlowLink>
				</Dropdown.Item>
			</Dropdown.Content>
		</Dropdown.Root>
	);
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
	const [isActive] = useRoute(href);

	let extras = "";
	if (isActive) {
		extras += " bg-gray-a3";
	}

	return (
		<FastLink
			className={
				"hover:bg-gray-a3 focus flex h-10 items-center justify-center px-3 -outline-offset-2" +
				extras
			}
			href={href}
		>
			{children}
		</FastLink>
	);
}

function Hamburger() {
	return (
		<Dropdown.Root>
			<Dropdown.Trigger asChild>
				<Button size="icon" variant="ghost" className="-outline-offset-2">
					<HamburgerMenuIcon />
				</Button>
			</Dropdown.Trigger>
			<Dropdown.Content>
				<Dropdown.Item asChild>
					<SlowLink href="/settings">settings</SlowLink>
				</Dropdown.Item>
				<Dropdown.Item
					onSelect={() => {
						/**
						 * TODO: logout
						 */
					}}
				>
					logout
				</Dropdown.Item>
			</Dropdown.Content>
		</Dropdown.Root>
	);
}
