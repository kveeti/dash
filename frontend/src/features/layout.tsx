import { JSX } from "solid-js";

import { Nav } from "./nav/nav";

export function Layout(props: { children: JSX.Element }) {
  return (
    <>
      <Nav />

      <main style={{ height: "100%" }}>{props.children}</main>
    </>
  );
}
