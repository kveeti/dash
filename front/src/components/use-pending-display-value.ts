import { useCallback, useEffect, useRef, useState } from "react";

function defaultIsEqual<T>(a: T, b: T) {
	return Object.is(a, b);
}

type PendingValue<T> = {
	value: T;
	baseValue: T;
	settled: boolean;
	token: number;
};

export function usePendingDisplayValue<T>(
	authoritativeValue: T,
	isEqual: (a: T, b: T) => boolean = defaultIsEqual,
) {
	const tokenRef = useRef(0);
	const [pending, setPending] = useState<PendingValue<T> | null>(null);
	const pendingResolved =
		pending !== null && isEqual(authoritativeValue, pending.value);
	const pendingObsolete =
		pending !== null &&
		pending.settled &&
		!isEqual(authoritativeValue, pending.baseValue);
	const shouldClearPending = pendingResolved || pendingObsolete;
	const activePending = pending && !shouldClearPending ? pending : null;

	useEffect(() => {
		if (!pending || !shouldClearPending) return;
		const token = pending.token;
		const timer = setTimeout(() => {
			setPending((current) => (current?.token === token ? null : current));
		}, 0);
		return () => clearTimeout(timer);
	}, [pending, shouldClearPending]);

	const run = useCallback(
		async (nextValue: T, action: () => Promise<void>) => {
			const token = tokenRef.current + 1;
			tokenRef.current = token;
			setPending({
				value: nextValue,
				baseValue: authoritativeValue,
				settled: false,
				token,
			});

			try {
				await action();
				setPending((current) =>
					current?.token === token ? { ...current, settled: true } : current,
				);
			} catch (error) {
				setPending((current) => (current?.token === token ? null : current));
				throw error;
			}
		},
		[authoritativeValue],
	);

	return {
		value: activePending?.value ?? authoritativeValue,
		run,
	};
}
