import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { CheckIcon, MinusIcon } from "@heroicons/react/24/outline";

export function Checkbox({ className, ...rest }: BaseCheckbox.Root.Props) {
  return (
    <BaseCheckbox.Root
      {...rest}
      className={`relative inline-flex size-[1.15rem] shrink-0 cursor-pointer items-center justify-center rounded-[.4rem] border border-gray-350 data-indeterminate:bg-gray-400 bg-(--input-bg)/80 text-white outline-[1.5px] outline-transparent outline-offset-2 after:absolute after:-inset-[.6rem] after:content-[''] hover:bg-(--input-bg-alt)/80 focus-visible:outline-gray-500 data-checked:border-success-solid data-checked:bg-success-solid data-checked:hover:bg-success-solid-hover ${className ?? ""}`}
    >
      <BaseCheckbox.Indicator className="group flex size-full items-center justify-center">
        <CheckIcon
          className="size-[.8rem] group-data-indeterminate:hidden"
          strokeWidth={3.5}
        />
        <MinusIcon
          className="text-gray-50 hidden size-[.8rem] group-data-indeterminate:block"
          strokeWidth={3.5}
        />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}
