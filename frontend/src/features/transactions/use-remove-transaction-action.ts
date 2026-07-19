import { useRef } from "react";

import { useRemoveTransactionsMutation } from "../../api/transactions";
import {
  createAlertDialogHandle,
  type AlertDialogHandle,
} from "../../ui/alert-dialog/alert-dialog-handle";
import type { TransactionActionGroup } from "./transaction-action-types";

const group: TransactionActionGroup = {
  id: "remove",
  name: null,
  items: [{ type: "remove", id: "remove", name: "Remove transactions" }],
};

export function useRemoveTransactionAction(props: {
  ids: string[];
  onFinish: () => void;
}) {
  const mutation = useRemoveTransactionsMutation();
  const dialogRef = useRef<AlertDialogHandle | null>(null);
  dialogRef.current ??= createAlertDialogHandle();

  function request() {
    if (mutation.isPending) return;
    const ids = [...props.ids];
    const multiple = ids.length > 1;
    dialogRef.current?.openWithPayload({
      title: multiple ? "Remove transactions?" : "Remove transaction?",
      description:
        "Are you sure? Imported transactions will return to the inbox. Manually added transactions will be deleted.",
      confirmLabel: multiple ? "Remove transactions" : "Remove transaction",
      confirmVariant: "destructive",
      onConfirm: () => mutation.mutate(ids, { onSuccess: props.onFinish }),
    });
  }

  return { group, request, dialogHandle: dialogRef.current };
}
