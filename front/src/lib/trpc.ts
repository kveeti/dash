import { createTRPCReact } from "@trpc/react-query";

import type { Router } from "../../../back/src/routes/_router.ts";

export const trpc = createTRPCReact<Router>();
