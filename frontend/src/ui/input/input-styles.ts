export const inputControlClassName =
  "h-9 w-full rounded-xl px-3 font-[inherit] text-gray-900 outline-[1.5px] outline-transparent outline-offset-[-1.5px] placeholder:text-(--input-placeholder) hover:outline-(--input-ring-hover) focus-visible:outline-(--input-ring-active)";

export const invalidInputClassName = "!outline-(--input-invalid-ring)";

export const inputTriggerClassName =
  "flex h-9 w-full cursor-default items-center gap-2 rounded-xl bg-(--input-bg)/80 px-3 text-start text-gray-900 outline-[1.5px] outline-transparent outline-offset-[-1.5px] hover:outline-(--input-ring-hover) focus-visible:outline-(--input-ring-active) data-popup-open:outline-(--input-ring-active)";

export const inputGroupClassName =
  "relative flex h-9 w-full items-stretch overflow-hidden rounded-xl [&>*]:h-full [&>*]:min-w-0 [&>*]:bg-transparent [&>*]:px-3 [&>*]:font-[inherit] [&>*]:text-gray-900 [&>*]:outline-[1.5px] [&>*]:outline-transparent [&>*]:outline-offset-[-1.5px] [&>*]:placeholder:text-(--input-placeholder) [&>*]:hover:outline-(--input-ring-hover) [&>*]:focus-visible:relative [&>*]:focus-visible:z-1 [&>*]:focus-visible:outline-(--input-ring-active) [&>*:first-child]:rounded-l-xl [&>*:last-child]:rounded-r-xl [&>input]:flex-1 [&>select]:cursor-pointer [&>select]:appearance-none [&>select]:pr-9";

export const invalidInputGroupClassName =
  "[&>*]:!outline-(--input-invalid-ring)";

export const fileInputClassName =
  "overflow-hidden py-1 file:-my-1 file:-ml-3 file:mr-3 file:h-9 file:cursor-pointer file:bg-(--input-bg-alt)/80 file:px-3 !file:text-gray-900";
