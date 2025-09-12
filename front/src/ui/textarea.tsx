import { type ComponentProps, useId } from "react";

import { Error, LabelWrapper } from "./input";

export const labelStyles = "text-gray-11 block";

export const inputStyles =
	"focus field-sizing-content min-w-0 max-w-full w-full p-3 border border-gray-6 rounded-none bg-transparent text-inherit placeholder:opacity-80 focus:relative focus:z-10";

type DefaultTextareaProps = ComponentProps<"textarea">;
type Props = { label?: string; error?: string } & DefaultTextareaProps;

export const Textarea = function Textarea({
	label,
	error,
	id,
	className,
	required,
	...rest
}: Props) {
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

				<_Textarea id={innerId} required={required} {...rest} aria-describedby={errorId} />
			</div>
		);
	}

	return <_Textarea id={innerId} required={required} {...rest} />;
};

function _Textarea({ className, ...rest }: DefaultTextareaProps) {
	return <textarea className={inputStyles + (className ? " " + className : "")} {...rest} />;
}
