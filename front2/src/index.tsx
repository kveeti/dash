import React from "react";
import ReactDOM from "react-dom/client";

import { Entrypoint } from "./entrypoint";
import { Providers } from "./providers";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<Providers>
			<Entrypoint />
		</Providers>
	</React.StrictMode>
);
