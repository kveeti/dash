import { ArrowUturnLeftIcon } from "@heroicons/react/24/outline";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AlertDialog } from "../../ui/alert-dialog/alert-dialog";
import {
  createAlertDialogHandle,
  type AlertDialogHandle,
} from "../../ui/alert-dialog/alert-dialog-handle";
import {
  UndoContext,
  useUndo,
  type RegisteredUndoAction,
  type UndoAction,
} from "./undo-context";

export function UndoProvider(props: { children: ReactNode }) {
  const [action, setAction] = useState<RegisteredUndoAction | null>(null);
  const actionRef = useRef(action);
  const sequence = useRef(0);
  const dialogRef = useRef<AlertDialogHandle | null>(null);
  actionRef.current = action;
  dialogRef.current ??= createAlertDialogHandle();

  const remember = useCallback((nextAction: UndoAction) => {
    const key = ++sequence.current;
    setAction({ ...nextAction, key });
    return () =>
      setAction((current) => (current?.key === key ? null : current));
  }, []);

  const run = useCallback((nextAction: RegisteredUndoAction) => {
    setAction((current) => (current?.key === nextAction.key ? null : current));
    nextAction.undo();
  }, []);

  const requestUndo = useCallback(() => {
    const current = actionRef.current;
    if (!current || dialogRef.current?.isOpen) return;

    const confirmation = current.confirmation?.();
    if (confirmation) {
      dialogRef.current?.openWithPayload({
        ...confirmation,
        confirmLabel: "Undo",
        onConfirm: () => run(current),
      });
      return;
    }

    run(current);
  }, [run]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "z" ||
        (!event.metaKey && !event.ctrlKey) ||
        event.shiftKey
      )
        return;

      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable]")
      )
        return;

      if (!actionRef.current) return;
      event.preventDefault();
      requestUndo();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [requestUndo]);

  return (
    <UndoContext.Provider value={{ action, remember, requestUndo }}>
      {props.children}
      <AlertDialog handle={dialogRef.current} />
    </UndoContext.Provider>
  );
}

export function UndoNotice(props: { raised: boolean }) {
  const undo = useUndo();

  return (
    <div
      key={undo.action?.key}
      className={undo.action ? "relative z-4 sm:hidden" : "invisible sm:hidden"}
      inert={!undo.action}
    >
      <span className="sr-only" role="status">
        {undo.action?.label}
      </span>
      <button
        className="fixed start-3 bottom-[calc(var(--nav-height)+var(--filterbar-height)+0.75rem)] z-4 inline-flex h-9 animate-[float-in-opacity_80ms_ease-out,float-in-translate_420ms_cubic-bezier(.22,1.55,.36,1),expire_100ms_6s_forwards] items-center justify-center gap-2 rounded-2xl border border-(--popover-border) bg-popover px-3 shadow-float transition-[bottom] duration-420 ease-[cubic-bezier(.22,1.55,.36,1)] data-[raised=true]:bottom-[calc(var(--nav-height)+var(--filterbar-height)+4.5rem)] motion-reduce:animate-[expire_100ms_6s_forwards] motion-reduce:transition-none"
        data-raised={props.raised}
        onClick={undo.requestUndo}
      >
        <ArrowUturnLeftIcon className="size-3.5" strokeWidth={2} />
        Undo
      </button>
    </div>
  );
}
