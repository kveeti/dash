import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function AnimatedHeight(props: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    function measure(element: HTMLDivElement) {
      const nextHeight = parseFloat(getComputedStyle(element).height);
      setHeight((current) => (current === nextHeight ? current : nextHeight));
    }
    measure(content);
    const frame = requestAnimationFrame(() => measure(content));
    const observer = new ResizeObserver(() => measure(content));
    observer.observe(content);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return (
    <div
      className="overflow-hidden motion-safe:transition-[height] motion-safe:duration-250 motion-safe:ease-[cubic-bezier(.05,.95,.15,1)]"
      style={{ height }}
    >
      <div ref={contentRef}>{props.children}</div>
    </div>
  );
}
