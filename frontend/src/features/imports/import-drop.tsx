import { DocumentArrowDownIcon } from "@heroicons/react/24/outline";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";

import { ImportDropContext } from "./import-drop-context";

function isCsv(file: File) {
  return file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv");
}

export function ImportDropProvider({ children }: { children: ReactNode }) {
  const [, navigate] = useLocation();
  const dragDepth = useRef(0);
  const [drop, setDrop] = useState({
    file: null as File | null,
    active: false,
  });

  useEffect(() => {
    const handleDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current++;
      setDrop((current) => ({ ...current, active: true }));
    };
    const handleDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const handleDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) {
        setDrop((current) => ({ ...current, active: false }));
      }
    };
    const handleDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      const csv = Array.from(event.dataTransfer!.files).find(isCsv);
      setDrop((current) => ({
        file: csv ?? current.file,
        active: false,
      }));
      if (csv) navigate("/imports");
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [navigate]);

  const clearFile = useCallback(
    () => setDrop((current) => ({ ...current, file: null })),
    [],
  );
  const value = useMemo(
    () => ({ file: drop.file, clearFile }),
    [drop.file, clearFile],
  );

  return (
    <ImportDropContext.Provider value={value}>
      {children}
      <div
        data-active={drop.active}
        className="pointer-events-none fixed inset-0 z-30 grid invisible p-3 backdrop-blur-[2px] transition-[opacity,visibility] opacity-0 data-[active=true]:opacity-100 duration-120 data-[active=true]:visible motion-reduce:transition-none"
      >
        <div className="grid place-items-center rounded-2xl border-2 border-dashed border-gray-500">
          <div className="flex flex-col items-center gap-2 text-center text-gray-900 bg-popover/70 px-20 py-16 rounded-2xl border border-popover-border">
            <DocumentArrowDownIcon
              className="size-12 text-gray-700"
              aria-hidden="true"
            />
            <p className="text-lg font-medium">Drop CSV to import</p>
            <p className="text-sm text-gray-700">
              You’ll choose the account next
            </p>
          </div>
        </div>
      </div>
    </ImportDropContext.Provider>
  );
}

function hasFiles(event: DragEvent) {
  return event.dataTransfer?.types.includes("Files");
}
