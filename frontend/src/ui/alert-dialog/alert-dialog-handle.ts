import { AlertDialog } from "@base-ui/react/alert-dialog";

import type { ButtonVariant } from "../button/button";

export interface AlertDialogPayload {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  onConfirm: () => void;
}

export type AlertDialogHandle = AlertDialog.Handle<AlertDialogPayload>;

export function createAlertDialogHandle() {
  return AlertDialog.createHandle<AlertDialogPayload>();
}
