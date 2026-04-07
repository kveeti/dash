import { useState } from "react";
import { Button } from "../../components/button";
import { useSync } from "../../lib/use-sync";
import { SignupForm } from "./signup-form";
import { LoginForm } from "./login-form";
import { UnlockForm } from "./unlock-form";
import { SyncStatusView } from "./sync-status";

export function SyncPage() {
	const { auth, status, error, lastSyncAt, sync, logout, forceReset } = useSync();

	if (status === "locked") {
		return (
			<Page title="Sync locked">
				<UnlockForm />
			</Page>
		);
	}

	if (status === "unconfigured") {
		return <UnconfiguredView />;
	}

	return (
		<Page title="Sync">
			{auth && (
				<p className="text-gray-11 text-xs mb-4 font-mono select-all">
					ID: {auth.userId}
				</p>
			)}
			<SyncStatusView
				status={status}
				error={error}
				lastSyncAt={lastSyncAt}
				onSync={sync}
				onLogout={logout}
				onForceReset={forceReset}
			/>
		</Page>
	);
}

function UnconfiguredView() {
	const [mode, setMode] = useState<"signup" | "login">("signup");

	return (
		<Page title="Set up sync">
			<div className="flex gap-2 mb-4">
				<Button
					variant={mode === "signup" ? "primary" : "outline"}
					size="sm"
					onClick={() => setMode("signup")}
				>
					Sign up
				</Button>
				<Button
					variant={mode === "login" ? "primary" : "outline"}
					size="sm"
					onClick={() => setMode("login")}
				>
					Log in
				</Button>
			</div>
			{mode === "signup" ? <SignupForm /> : <LoginForm />}
		</Page>
	);
}

function Page({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<main className="w-full p-4 pb-20 sm:pt-14">
			<h1 className="text-lg font-bold mb-4">{title}</h1>
			{children}
		</main>
	);
}
