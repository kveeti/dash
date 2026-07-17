import { createContext } from "../create-context";

export interface UndoConfirmation {
  title: string;
  description: string;
}

export interface UndoAction {
  label: string;
  undo: () => void;
  confirmation?: () => UndoConfirmation | null;
}

export interface RegisteredUndoAction extends UndoAction {
  key: number;
}

export const [useUndo, UndoContext] = createContext<{
  action: RegisteredUndoAction | null;
  remember: (action: UndoAction) => () => void;
  requestUndo: () => void;
}>();
