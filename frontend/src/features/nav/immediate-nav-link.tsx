import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";

export function ImmediateNavLink(props: { href: string; children: ReactNode }) {
  const [, navigate] = useLocation();
  const isLocal = () =>
    new URL(props.href, window.location.href).origin === window.location.origin;

  return (
    <Link
      href={props.href}
      className={(isActive) =>
        `inline-flex h-full items-center px-1.5 text-sm text-inherit no-underline outline-2 outline-transparent outline-offset-[-2px] min-[18rem]:px-3 min-[18rem]:text-base ${isActive ? "underline" : ""} hover:bg-gray-200/80 focus-visible:rounded-none focus-visible:outline-(--input-ring-active)`
      }
      onClick={(event) => {
        if (
          isLocal() &&
          event.button === 0 &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
        }
      }}
      onMouseDown={(event) => {
        if (
          isLocal() &&
          event.button === 0 &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          navigate(props.href);
        }
      }}
      onTouchStart={(event) => {
        if (
          isLocal() &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          navigate(props.href);
        }
      }}
      onKeyUp={(event) => {
        if (
          isLocal() &&
          (event.key === "Enter" ||
            event.key === " " ||
            event.key === "Space") &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault();
          navigate(props.href);
        }
      }}
    >
      {props.children}
    </Link>
  );
}
