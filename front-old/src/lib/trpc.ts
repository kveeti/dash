import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";

import type { Router } from "../../../back/src/routes/_router.ts";

export const trpc = createTRPCReact<Router>();
export type ApiRes = inferRouterOutputs<Router>;
