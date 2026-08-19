import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEventHandler,
  type InputHTMLAttributes,
  type Ref,
} from "react";

import { useFieldInvalid } from "./field-context";
import { hasBackgroundClass, inputShellClassName } from "./input-styles";

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
