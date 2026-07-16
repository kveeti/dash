import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import styles from "./animated-height.module.css";

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
    <div className={styles.root} style={{ height }}>
      <div ref={contentRef}>{props.children}</div>
    </div>
  );
}
