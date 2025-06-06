import { getData } from "./data/data.ts";
import * as _ from "./envs.ts";
import { createServer } from "./server.ts";

const data = await getData();

const server = createServer({ port: 8000, data });

server.start();

const close = () => {
	console.info("closing...");
	void Promise.allSettled([server.close(), data.close()]).then(() => {
		process.exit(0);
	});
};

process.on("SIGINT", close);
process.on("SIGTERM", close);
