import styles from "./input.module.css";

export const inputShellClassName = `${styles.shell} relative block h-9 w-full overflow-hidden rounded-xl outline-2 outline-transparent outline-offset-[-2px]`;

export const inputControlClassName = `${styles.control} h-full w-full rounded-none border-0 bg-transparent px-3 font-[inherit] text-gray-900 outline-none placeholder:text-(--input-placeholder) placeholder:opacity-100`;

export const popupInputShellClassName =
  "relative block w-full border-b-[0.5px] border-popover-border";

export const popupInputControlClassName = inputControlClassName;

export const inputPaddingStartWideClassName = styles.paddingStartWide;

export const inputPaddingEndWideClassName = styles.paddingEndWide;

export const inputPaddingEndExtraWideClassName = styles.paddingEndExtraWide;

export const inputShellPaddingEndWideClassName = styles.shellPaddingEndWide;

export const invalidInputClassName = "!outline-(--input-invalid-ring)";

export const inputTriggerClassName =
  "flex h-9 w-full cursor-default items-center gap-2 rounded-xl bg-(--input-bg)/80 px-3 text-start text-gray-900 outline-2 outline-transparent outline-offset-[-2px] hover:outline-(--input-ring-hover) focus-visible:outline-(--input-ring-active) data-popup-open:outline-(--input-ring-active)";

export const inputGroupClassName = `${styles.group} relative flex h-9 w-full items-stretch overflow-hidden rounded-xl`;

export const inputGroupInputClassName = styles.groupInput;

export const inputGroupSelectClassName = styles.groupSelect;
