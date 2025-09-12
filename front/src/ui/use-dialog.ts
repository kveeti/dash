import { useEffect, useState } from "react";

export function useDialog(isOpen = false) {
	const [_isOpen, setIsOpen] = useState(isOpen);

	useEffect(() => {
		setIsOpen(isOpen);
	}, [isOpen]);

	function open() {
		setIsOpen(true);
	}

	function close() {
		setIsOpen(false);
	}

	return {
		open,
		close,
		props: {
			open: _isOpen,
			onOpenChange: setIsOpen,
		},
	};
}

export type UseDialog = ReturnType<typeof useDialog>;
