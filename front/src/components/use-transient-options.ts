import { useCallback, useMemo, useState } from "react";

export function useTransientOptions<T>(
	options: T[],
	getKey: (option: T) => string,
	shouldKeep?: (option: T) => boolean,
) {
	const [transientOptions, setTransientOptions] = useState<T[]>([]);
	const mergedOptions = useMemo(() => {
		const optionKeys = new Set(options.map(getKey));
		const unresolvedTransientOptions = transientOptions.filter(
			(option) =>
				!optionKeys.has(getKey(option)) && (shouldKeep?.(option) ?? true),
		);
		return [...options, ...unresolvedTransientOptions];
	}, [getKey, options, shouldKeep, transientOptions]);

	const add = useCallback(
		(option: T) => {
			const key = getKey(option);
			setTransientOptions((current) => [
				option,
				...current.filter((currentOption) => getKey(currentOption) !== key),
			]);
		},
		[getKey],
	);

	return {
		options: mergedOptions,
		add,
	};
}
