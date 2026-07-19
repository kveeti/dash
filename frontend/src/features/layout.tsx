import type { ReactNode } from "react";

import { Nav } from "./nav/nav";

export function Layout(props: { children: ReactNode }) {
  return (
    <>
      <Nav />
      <main className="text-base pl-(--scrollbar-pl)">{props.children}</main>
    </>
  );
}
