import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";

import { Button } from "../button/button";
import type { AlertDialogHandle } from "./alert-dialog-handle";

import styles from "./alert-dialog.module.css";

export function AlertDialog(props: { handle: AlertDialogHandle }) {
  return (
    <BaseAlertDialog.Root handle={props.handle}>
      {({ payload }) => (
        <BaseAlertDialog.Portal>
          <BaseAlertDialog.Backdrop className={styles.backdrop} />
          <BaseAlertDialog.Popup className={styles.popup}>
            <div className={styles.intro}>
              <BaseAlertDialog.Title className={styles.title}>
                {payload?.title}
              </BaseAlertDialog.Title>
              <BaseAlertDialog.Description className={styles.description}>
                {payload?.description}
              </BaseAlertDialog.Description>
            </div>
            <div className={styles.actions}>
              <BaseAlertDialog.Close render={<Button variant="outline" />}>
                {payload?.cancelLabel ?? "Cancel"}
              </BaseAlertDialog.Close>
              <BaseAlertDialog.Close
                render={<Button variant={payload?.confirmVariant} />}
                onClick={payload?.onConfirm}
              >
                {payload?.confirmLabel ?? "Confirm"}
              </BaseAlertDialog.Close>
            </div>
          </BaseAlertDialog.Popup>
        </BaseAlertDialog.Portal>
      )}
    </BaseAlertDialog.Root>
  );
}
