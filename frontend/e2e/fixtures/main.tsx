import { Router } from "@solidjs/router";
import { render } from "solid-js/web";

import { comboboxRoutes } from "./combobox/routes";

render(
  () => <Router root={(props) => props.children}>{comboboxRoutes}</Router>,
  document.getElementById("root")!,
);
