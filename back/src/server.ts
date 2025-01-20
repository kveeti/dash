import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { createServer as _createServer } from "node:http";

import type { Data } from "./data/data.ts";
import { rootRouter } from "./routes/_router.ts";
import { auth } from "./services/auth.ts";
import { createContext } from "./trpc.ts";

export function createServer({ port, data }: { port: number; data: Data }) {
	const services = {
		auth: auth(data),
	};

	const trpcHandler = createHTTPHandler({
		router: rootRouter,
		createContext: createContext(data, services),
	});

	const s = _createServer((req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-csrf");
		res.setHeader("Access-Control-Allow-Credentials", "true");

		const isPreflight = req.method === "OPTIONS";
		if (isPreflight) {
			res.writeHead(204);
			res.end();
			return;
		}

		return trpcHandler(req, res);
	});

	return {
		start: () => {
			s.listen(port, () => console.log(`listening on port ${port}`));
		},
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				s.close((err) => {
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			});
		},
	};
}
