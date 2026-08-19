export const pages = [
  { label: "inbox", href: "/inbox" },
  { label: "transactions", href: "/transactions" },
  { label: "stats", href: "/stats" },
  { label: "import", href: "/imports" },
  { label: "banks", href: "/connections" },
];

export const navPages = pages.filter(
  (page) => page.href !== "/imports" && page.href !== "/connections",
);

export const menuPages = pages.filter(
  (page) => page.href === "/imports" || page.href === "/connections",
);
