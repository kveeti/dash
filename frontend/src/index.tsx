/* @refresh reload */
import "solid-devtools";
import "./index.css";
import { Router } from "@solidjs/router";
import { render } from "solid-js/web";

import { routes } from "./routes";

const root = document.getElementById("root");

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("No root elem");
}

render(() => <Router root={(props) => props.children}>{routes}</Router>, root);
