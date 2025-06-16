import { createContext as react_createContext, useContext as react_useContext } from "react";

export const createContext = <ContextType>() => {
	const context = react_createContext<ContextType | undefined>(undefined);

	const useContext = () => {
		const c = react_useContext(context);
		if (c === undefined) {
			throw new Error("useContext must be inside a Provider with a value");
		}
		return c;
	};

	return [useContext, context] as const;
};
