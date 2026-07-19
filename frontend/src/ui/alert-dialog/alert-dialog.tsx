import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";

import { Button } from "../button/button";
import type { AlertDialogHandle } from "./alert-dialog-handle";

export function AlertDialog(props: { handle: AlertDialogHandle }) {
  return (
    <BaseAlertDialog.Root handle={props.handle}>
      {({ payload }) => (
        <BaseAlertDialog.Portal>
          <BaseAlertDialog.Backdrop className="fixed inset-0 z-20 min-h-dvh bg-black/5 transition-opacity duration-180 ease-[cubic-bezier(.16,1,.3,1)] supports-[-webkit-touch-callout:none]:absolute data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:duration-[1ms]" />
          <BaseAlertDialog.Popup className="fixed top-1/2 left-1/2 z-21 flex w-[min(24rem,calc(100vw-1rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-popover-border bg-popover p-4 text-base text-gray-900 shadow-float transition-[opacity,scale] duration-180 ease-[cubic-bezier(.16,1,.3,1)] data-starting-style:scale-[.97] data-starting-style:opacity-0 data-ending-style:scale-[.97] data-ending-style:opacity-0 motion-reduce:duration-[1ms]">
            <div className="flex flex-col gap-1">
              <BaseAlertDialog.Title className="text-md font-semibold">
                {payload?.title}
              </BaseAlertDialog.Title>
              <BaseAlertDialog.Description className="text-sm text-gray-700">
                {payload?.description}
              </BaseAlertDialog.Description>
            </div>
            <div className="flex justify-end gap-2">
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
