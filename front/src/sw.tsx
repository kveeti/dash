import { useState } from "react";
import { toast } from "sonner";

import { Button } from "./ui/button";

export default function Sw() {
	return null;
}

function UpdateToast({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
	const [isLoading, setIsLoading] = useState(false);
	return (
		<div className="font-default border-gray-a4 bg-gray-1 flex w-[300px] flex-col gap-4 border p-3 text-sm shadow-lg">
			<p>update available!</p>

			<div className="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onClick={onCancel}>
					not yet!
				</Button>
				<Button
					size="sm"
					onClick={() => {
						setIsLoading(true);
						onConfirm();
					}}
					isLoading={isLoading}
				>
					update
				</Button>
			</div>
		</div>
	);
}

// this next bit is from `vite-pwa/vite-plugin-pwa`
export function registerSW({ onNeedRefresh }: { onNeedRefresh: () => void }) {
	let wb: import("workbox-window").Workbox | undefined;
	let registerPromise: Promise<void>;
	let sendSkipWaitingMessage: () => void | undefined;

	const updateServiceWorker = async (_reloadPage = true) => {
		await registerPromise;
		sendSkipWaitingMessage?.();
	};

	async function register() {
		if ("serviceWorker" in navigator) {
			wb = await import("workbox-window")
				.then(({ Workbox }) => {
					return new Workbox("/sw.js");
				})
				.catch((_e) => {
					return undefined;
				});

			if (!wb) return;

			sendSkipWaitingMessage = () => {
				wb?.messageSkipWaiting();
			};
			const showSkipWaitingPrompt = () => {
				wb?.addEventListener("controlling", (event) => {
					if (event.isUpdate) window.location.reload();
				});

				onNeedRefresh?.();
			};
			wb.addEventListener("installed", (event) => {
				if (typeof event.isUpdate === "undefined") {
					if (typeof event.isExternal !== "undefined") {
						if (event.isExternal) showSkipWaitingPrompt();
					}
				}
			});
			wb.addEventListener("waiting", showSkipWaitingPrompt);

			wb.register();
		}
	}

	registerPromise = register();

	return updateServiceWorker;
}

const updateSW = registerSW({
	onNeedRefresh() {
		toast.custom(
			(toastId) => (
				<UpdateToast onConfirm={updateSW} onCancel={() => toast.dismiss(toastId)} />
			),
			{ duration: 20000, position: "bottom-right" }
		);
	},
});
