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
import { Button } from "../../ui/button/button";
import { FloatingBarWrap } from "../list-shell/floating-bar";
import {
  UndoContext,
  useUndo,
  type RegisteredUndoAction,
  type UndoAction,
} from "./undo-context";

import listShell from "../list-shell/list-shell.module.css";
import styles from "./undo.module.css";

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

export function UndoNotice(props: { hide: boolean }) {
  const undo = useUndo();

  return (
    <div
      key={undo.action?.key}
      className={undo.action ? styles.notice : undefined}
    >
      <FloatingBarWrap show={Boolean(undo.action) && !props.hide}>
        <span className={listShell.count} role="status">
          {undo.action?.label}
        </span>
        <Button variant="ghost" onClick={undo.requestUndo}>
          Undo
        </Button>
      </FloatingBarWrap>
    </div>
  );
}
