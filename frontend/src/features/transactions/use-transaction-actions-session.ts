import { useState } from "react";

type Session = {
  open: boolean;
  input: string;
};

export function useTransactionActionsSession() {
  const [session, setSession] = useState<Session | null>(null);

  function setInput(input: string) {
    setSession((current) => (current ? { ...current, input } : current));
  }

  function setOpen(open: boolean) {
    setSession((current) => {
      if (open) {
        return current
          ? { ...current, open: true }
          : { open: true, input: "", retainedTags: [] };
      }
      return current ? { ...current, open: false } : null;
    });
  }

  function completeOpenChange(open: boolean) {
    if (!open) setSession(null);
  }

  return {
    open: session?.open ?? false,
    input: session?.input ?? "",
    setInput,
    setOpen,
    completeOpenChange,
  };
}
