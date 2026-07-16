import type { ReactNode } from "react";

import { Nav } from "./nav/nav";

export function Layout(props: { children: ReactNode }) {
  return (
    <>
      <Nav />
      <main style={{ height: "100%" }}>{props.children}</main>
    </>
  );
}
