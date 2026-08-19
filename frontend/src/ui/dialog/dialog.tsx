import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { forwardRef, type ReactNode } from "react";

type DialogProps = Omit<BaseDialog.Root.Props, "children"> & {
  children: ReactNode;
};

export function Dialog({ children, ...props }: DialogProps) {
  return (
    <BaseDialog.Root {...props}>
      <BaseDialog.Portal>{children}</BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

type BackdropProps = Omit<BaseDialog.Backdrop.Props, "className"> & {
  className?: string;
};

export const DialogBackdrop = forwardRef<HTMLDivElement, BackdropProps>(
  function DialogBackdrop({ className, ...props }, ref) {
    return (
      <BaseDialog.Backdrop
        {...props}
        ref={ref}
        className={`fixed inset-0 z-20 transition-opacity duration-180 ease-[cubic-bezier(.16,1,.3,1)] data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:duration-[1ms] ${className ?? ""}`}
      />
    );
  },
);

type PopupProps = Omit<BaseDialog.Popup.Props, "className"> & {
  className?: string;
};

export const DialogPopup = forwardRef<HTMLDivElement, PopupProps>(
  function DialogPopup({ className, ...props }, ref) {
    return (
      <BaseDialog.Popup
        {...props}
        ref={ref}
        className={`fixed z-21 flex -translate-x-1/2 flex-col rounded-xl border border-popover-border bg-popover text-base shadow-float transition-[opacity,scale] duration-180 ease-[cubic-bezier(.16,1,.3,1)] data-starting-style:scale-[.97] data-starting-style:opacity-0 data-ending-style:scale-[.97] data-ending-style:opacity-0 motion-reduce:duration-[1ms] ${className ?? ""}`}
      />
    );
  },
);

export const DialogTitle = BaseDialog.Title;
