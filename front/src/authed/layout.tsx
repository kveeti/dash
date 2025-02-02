import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import { type ReactNode } from "react";
import { toast } from "sonner";
import { useRoute } from "wouter";

import { errorToast } from "../lib/error-toast";
import { useMe } from "../lib/me";
import { trpc } from "../lib/trpc";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import * as Dropdown from "../ui/dropdown";
import { FastLink, SlowLink } from "../ui/link";

export function AuthLayout(props: { children: ReactNode }) {
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
				"bg-gray-1 right-0 left-0 flex h-10 items-center shadow-xs sm:top-0 sm:border-t-0 sm:border-b" +
				" " +
				"pwa:pb-10 pwa:sm:pb-0 border-gray-a4 fixed bottom-0 h-max border-t px-4 shadow-xs" +
				" " +
				"me-(--removed-body-scroll-bar-size)"
			}
		>
			<ul className="mx-auto flex w-full max-w-[800px] justify-between">
				<div className="flex">
					<Transactions />

					<li>
						<NavLink href="/transactions/stats">stats</NavLink>
					</li>
					<li>
						<NavLink href="/categories">categories</NavLink>
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

	return (
		<FastLink
			className={cn(
				"hover:bg-gray-a3 focus flex h-10 items-center justify-center px-3 -outline-offset-2",
				isActive && "bg-gray-a3"
			)}
			href={href}
		>
			{children}
		</FastLink>
	);
}

function Hamburger() {
	const { setMe } = useMe();
	const t = trpc.useUtils();
	const logout = trpc.v1.auth.logout.useMutation();

	function onLogout() {
		logout
			.mutateAsync()
			.then(async () => {
				t.invalidate(undefined, undefined, { cancelRefetch: true }).catch(() => {});
				setMe(null);
				localStorage.clear();
				toast.custom(() => (
					<div className="font-default border-gray-a4 bg-gray-1 flex w-(--width) flex-col gap-4 border p-3 text-sm shadow-lg">
						<p>logged out</p>
					</div>
				));
			})
			.catch(errorToast("error logging out"));
	}

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
				<Dropdown.Item onSelect={onLogout}>logout</Dropdown.Item>
			</Dropdown.Content>
		</Dropdown.Root>
	);
}
