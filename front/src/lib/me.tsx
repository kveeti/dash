import { useState } from "react";

import { createContext } from "./create-context";
import type { ApiRes } from "./trpc";

export type Me = ApiRes["v1"]["auth"]["me"];

const [useMe, meContext] = createContext<{
	me: Me | null;
	setMe: (me: Me | null) => void;
}>();

export { useMe };

export function MeProvider({
	children,
	initialMe,
}: {
	children: React.ReactNode;
	initialMe: Me | null;
}) {
	const [me, setMe] = useState<Me | null>(initialMe);

	return <meContext.Provider value={{ setMe, me }}>{children}</meContext.Provider>;
}
