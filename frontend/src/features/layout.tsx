import { JSX } from "solid-js";

import { Nav } from "./nav/nav";

export function Layout(props: { children: JSX.Element }) {
  return (
    <>
      <Nav />

      <main>{props.children}</main>
    </>
  );
}
