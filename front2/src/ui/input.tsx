import { type ComponentProps, useId } from "react";

import { FieldError } from "../lib/use-form";

export const labelStyles = "text-gray-11 block";

export const inputStyles =
	"focus min-w-0 max-w-full w-full px-3 h-10 border border-gray-6 rounded-none bg-transparent text-inherit placeholder:opacity-80 focus:relative focus:z-10";

type DefaultInputProps = ComponentProps<"input">;
type Props = { label?: string; error?: FieldError } & DefaultInputProps;

export const Input = function Input({ label, error, id, className, required, ...rest }: Props) {
	// eslint-disable-next-line react-hooks/rules-of-hooks -- the hook is not conditional
	const innerId = id || useId();

	if (label || error) {
		const errorId = error ? innerId + "-error" : undefined;
		return (
			<div className={className}>
				{(!!label || !!error) && (
					<LabelWrapper>
						{!!label && (
							<label htmlFor={innerId} className={labelStyles}>
								{label} {required ? <span className="text-red-10">*</span> : ""}
							</label>
						)}

						{!!error && errorId && <Error id={errorId}>{error}</Error>}
					</LabelWrapper>
				)}

				<_Input id={innerId} required={required} {...rest} aria-describedby={errorId} />
			</div>
		);
	}

	return <_Input id={innerId} required={required} {...rest} />;
};

function _Input({ className, ...rest }: DefaultInputProps) {
	return <input className={inputStyles + (className ? " " + className : "")} {...rest} />;
}

export function LabelWrapper({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			{...props}
			className={"mb-2 flex cursor-default items-center justify-between" + " " + className}
		/>
	);
}

export function Label({ className, ...props }: ComponentProps<"label">) {
	return <label {...props} className={labelStyles + " " + className} />;
}

export function Error({ className, ...props }: ComponentProps<"span"> & { id: string }) {
	return <span {...props} className={"color-red-10" + " " + className} />;
}
