import {
  ChevronDownIcon,
  ExclamationCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEventHandler,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
} from "react";

import { FieldInvalidContext, useFieldInvalid } from "./field-context";
import {
  inputControlClassName,
  inputGroupClassName,
  inputGroupInputClassName,
  inputGroupSelectClassName,
  inputPaddingEndExtraWideClassName,
  inputPaddingEndWideClassName,
  inputPaddingStartWideClassName,
  inputShellClassName,
  inputShellPaddingEndWideClassName,
  invalidInputClassName,
  inputTriggerClassName,
  popupInputControlClassName,
  popupInputShellClassName,
} from "./input-styles";

interface FieldProps {
  label?: string;
  error?: string;
  className?: string;
  /** Wrapper element; use "div" when the control isn't a native input. */
  as?: "label" | "div";
  children: ReactNode;
}

export function Field({ as: As = "label", ...props }: FieldProps) {
  const invalid = Boolean(props.error);

  return (
    <FieldInvalidContext.Provider value={invalid}>
      <As
        className={`flex flex-col gap-1 min-[30rem]:col-span-full min-[30rem]:grid min-[30rem]:grid-cols-subgrid min-[30rem]:items-center min-[30rem]:gap-x-8 min-[30rem]:[&>:last-child]:col-start-2 min-[30rem]:[&>:last-child]:row-start-2 ${props.className ?? ""}`}
      >
        {props.label && (
          <span className="flex items-baseline justify-between gap-2 min-[30rem]:col-start-1 min-[30rem]:row-start-2 min-[30rem]:justify-start">
            <span className="text-sm text-gray-700 min-[30rem]:text-right">
              {props.label}
            </span>
          </span>
        )}
        {props.error && (
          <span className="flex min-h-[1lh] items-center gap-1 text-xs text-(--input-invalid-text) min-[30rem]:col-start-2 min-[30rem]:row-start-1">
            <ExclamationCircleIcon
              className="size-[1.25em] shrink-0"
              aria-hidden="true"
            />
            {props.error}
          </span>
        )}
        {props.children}
      </As>
    </FieldInvalidContext.Provider>
  );
}

function hasBackgroundClass(className?: string) {
  return className?.split(/\s+/).some((name) => name.startsWith("bg-"));
}

export function InputGroup(props: {
  className?: string;
  children: ReactNode;
  /** Override the enclosing field state when group controls validate separately. */
  invalid?: boolean;
}) {
  const fieldInvalid = useFieldInvalid();
  const invalid = props.invalid ?? fieldInvalid;

  return (
    <FieldInvalidContext.Provider value={invalid}>
      <div
        aria-invalid={invalid || undefined}
        className={`${inputGroupClassName} ${hasBackgroundClass(props.className) ? "" : "bg-(--input-bg)/80"} ${props.className ?? ""}`}
      >
        {props.children}
      </div>
    </FieldInvalidContext.Provider>
  );
}

type Props = InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
  ref?: Ref<HTMLInputElement>;
} & (
    | {
        grouped: true;
        iconLeft?: never;
        iconRight?: never;
      }
    | {
        grouped?: false;
        iconLeft?: ReactNode;
        iconRight?: ReactNode;
      }
  );

type FileInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "accept" | "capture" | "multiple" | "onSelect" | "type"
> & {
  error?: string;
  acceptedFileTypes?: ReadonlyArray<string>;
  allowsMultiple?: boolean;
  defaultCamera?: "user" | "environment";
  onSelect?: (files: FileList | null) => void;
  files?: ReadonlyArray<File>;
  acceptDirectory?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function FileInput({
  error,
  acceptedFileTypes,
  allowsMultiple,
  defaultCamera,
  onSelect,
  files,
  acceptDirectory,
  className,
  onChange,
  ref,
  ...props
}: FileInputProps) {
  const fieldInvalid = useFieldInvalid();
  const invalid = Boolean(error) || fieldInvalid;
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFileNames, setSelectedFileNames] = useState<
    ReadonlyArray<string>
  >([]);
  const fileNames = files?.map((file) => file.name) ?? selectedFileNames;
  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;

    const handleReset = () => setSelectedFileNames([]);
    form.addEventListener("reset", handleReset);
    return () => form.removeEventListener("reset", handleReset);
  }, []);

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    const files = event.currentTarget.files;
    setSelectedFileNames(Array.from(files ?? [], (file) => file.name));
    onSelect?.(files);
    onChange?.(event);
  };

  return (
    <span
      data-invalid={invalid || undefined}
      className={`${inputShellClassName} flex ${hasBackgroundClass(className) ? "" : "bg-(--input-bg)/80"} ${className ?? ""}`}
    >
      <span
        role="button"
        tabIndex={props.disabled ? undefined : 0}
        aria-label="Choose File"
        aria-disabled={props.disabled || undefined}
        aria-invalid={invalid || undefined}
        className="flex h-full shrink-0 cursor-pointer items-center bg-(--input-bg-alt) px-3 text-gray-900 outline-none"
        onClick={(event) => {
          event.preventDefault();
          if (!props.disabled) inputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (!props.disabled) inputRef.current?.click();
        }}
      >
        Choose File
      </span>
      <span
        className="min-w-0 flex-1 self-center overflow-hidden px-3 text-ellipsis whitespace-nowrap text-gray-900"
        aria-live="polite"
      >
        {fileNames.length > 0 ? fileNames.join(", ") : "No file chosen"}
      </span>
      <input
        {...props}
        {...(acceptDirectory ? { webkitdirectory: "" } : {})}
        ref={setInputRef}
        type="file"
        accept={acceptedFileTypes?.toString()}
        capture={defaultCamera}
        multiple={allowsMultiple}
        aria-invalid={invalid || undefined}
        className="hidden"
        onChange={handleChange}
      />
    </span>
  );
}

export function Input({
  error,
  grouped,
  iconLeft,
  iconRight,
  className,
  ...rest
}: Props) {
  const fieldInvalid = useFieldInvalid();
  const invalid = Boolean(error) || fieldInvalid;

  if (grouped) {
    return (
      <span
        data-invalid={invalid || undefined}
        className={`${inputShellClassName} ${inputGroupInputClassName} ${className ?? ""}`}
      >
        <input
          {...rest}
          aria-invalid={invalid || undefined}
          className={inputControlClassName}
        />
      </span>
    );
  }

  return (
    <span
      data-invalid={invalid || undefined}
      className={`${inputShellClassName} ${hasBackgroundClass(className) ? "" : "bg-(--input-bg)/80"} ${className ?? ""}`}
    >
      {iconLeft && (
        <span
          className="pointer-events-none absolute inset-y-0 start-3 z-1 flex items-center text-gray-600 [&>svg]:size-4"
          aria-hidden="true"
        >
          {iconLeft}
        </span>
      )}
      <input
        {...rest}
        aria-invalid={invalid || undefined}
        className={`${inputControlClassName} ${iconLeft ? inputPaddingStartWideClassName : ""} ${iconRight ? inputPaddingEndWideClassName : ""}`}
      />
      {iconRight && (
        <span
          className="pointer-events-none absolute inset-y-0 end-3 z-1 flex items-center text-gray-600 [&>svg]:size-4"
          aria-hidden="true"
        >
          {iconRight}
        </span>
      )}
    </span>
  );
}

type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  onClear: () => void;
};

export function SearchInput({
  onClear,
  className,
  ...props
}: SearchInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <span className="relative block w-full [&:has(input:placeholder-shown)>button]:invisible [&_input::-webkit-search-cancel-button]:hidden">
      <Input
        {...props}
        ref={ref}
        type="search"
        className={`${inputShellPaddingEndWideClassName} ${className ?? ""}`}
      />
      <button
        type="button"
        aria-label="Clear search"
        className="absolute end-1 top-1/2 z-1 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-gray-600 outline-2 outline-transparent outline-offset-[-1px] hover:bg-gray-200 hover:text-gray-900 focus-visible:outline-gray-500"
        onClick={() => {
          if (ref.current) ref.current.value = "";
          onClear();
          ref.current?.focus();
        }}
      >
        <XMarkIcon className="size-4" aria-hidden="true" />
      </button>
    </span>
  );
}

type PopupSearchInputProps = InputHTMLAttributes<HTMLInputElement> & {
  loading?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function PopupSearchInput({
  loading,
  className,
  ...props
}: PopupSearchInputProps) {
  return (
    <span className={`${popupInputShellClassName} h-9 ${className ?? ""}`}>
      <input
        {...props}
        className={`${popupInputControlClassName} ${loading ? inputPaddingEndExtraWideClassName : ""}`}
      />
      {loading && (
        <span className="pointer-events-none absolute inset-y-0 end-3 z-1 flex items-center text-base text-gray-600">
          loading…
        </span>
      )}
    </span>
  );
}

type InputTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  invalid?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function InputTrigger({
  invalid: invalidProp,
  className,
  ...props
}: InputTriggerProps) {
  const fieldInvalid = useFieldInvalid();
  const invalid = invalidProp ?? fieldInvalid;

  return (
    <button
      {...props}
      aria-invalid={invalid || undefined}
      className={`${inputTriggerClassName} ${invalid ? invalidInputClassName : ""} ${className ?? ""}`}
    />
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  grouped?: boolean;
}

export function Select({
  error,
  grouped,
  className,
  children,
  ...rest
}: SelectProps) {
  const fieldInvalid = useFieldInvalid();
  const invalid = Boolean(error) || fieldInvalid;

  if (grouped) {
    return (
      <span
        data-invalid={invalid || undefined}
        className={`${inputShellClassName} ${inputGroupSelectClassName} ${className ?? ""}`}
      >
        <select
          {...rest}
          aria-invalid={invalid || undefined}
          className={`${inputControlClassName} ${inputPaddingEndWideClassName} cursor-pointer appearance-none`}
        >
          {children}
        </select>
        <ChevronDownIcon
          className="pointer-events-none absolute end-[.7rem] top-1/2 z-1 size-4 -translate-y-1/2 text-gray-700"
          aria-hidden="true"
        />
      </span>
    );
  }

  return (
    <span
      data-invalid={invalid || undefined}
      className={`${inputShellClassName} ${hasBackgroundClass(className) ? "" : "bg-(--input-bg)/80"} ${className ?? ""}`}
    >
      <select
        {...rest}
        aria-invalid={invalid || undefined}
        className={`${inputControlClassName} ${inputPaddingEndWideClassName} cursor-pointer appearance-none`}
      >
        {children}
      </select>
      <ChevronDownIcon
        className="pointer-events-none absolute end-[.7rem] top-1/2 z-1 size-4 -translate-y-1/2 text-gray-700"
        aria-hidden="true"
      />
    </span>
  );
}
