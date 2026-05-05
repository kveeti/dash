import { useEffect, useRef, useState } from "react";

export function SelectedTxCopyIdButton({ txId }: { txId: string }) {
	const [copied, setCopied] = useState(false);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
		};
	}, []);

	function copyId() {
		navigator.clipboard.writeText(txId);
		setCopied(true);
		if (copiedTimer.current) clearTimeout(copiedTimer.current);
		copiedTimer.current = setTimeout(() => setCopied(false), 1500);
	}

	return (
		<button
			type="button"
			onClick={copyId}
			className="text-sm text-gray-11 hover:text-gray-12"
		>
			{copied ? "copied!" : "copy id"}
		</button>
	);
}
