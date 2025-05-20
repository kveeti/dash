import { ReactNode, RefObject, createRef, useCallback, useRef, useState } from "react";

export type FieldError = string | null | undefined | false;

export interface Focusable {
	focus(): any;
}
type FieldRef = RefObject<Focusable | null>;

export function useForm(props: {
	validate?: {
		[key: string]: (value: unknown) => any;
	};
	defaultValues?: {
		[key: string]: any;
	};
	onSubmit: (data: Record<string, any>) => any;
}) {
	const fieldStates = useRef<
		Record<
			string,
			{
				value: unknown;
				isTouched: boolean;
			}
		>
	>({});
	const fieldRefs = useRef<Record<string, FieldRef>>({});
	const initializedFields = useRef<Record<string, boolean>>({});
	const [errors, _setErrors] = useState<Record<string, FieldError>>({});

	function getHandleChange(fieldName: string) {
		return function handleChange(value: unknown) {
			console.log("handleChange");

			fieldStates.current[fieldName].value = value;
			if (fieldStates.current[fieldName].isTouched) {
				const validationError = props.validate?.[fieldName]?.(value);
				if (!validationError) {
					_setErrors((prev) => ({
						...prev,
						[fieldName]: null,
					}));
				} else {
					_setErrors((prev) => ({
						...prev,
						[fieldName]: validationError,
					}));
				}
			}
		};
	}

	function getHandleBlur(fieldName: string) {
		return function handleBlur() {
			console.log("handleBlur");

			fieldStates.current[fieldName].isTouched = true;
			const value = fieldStates.current[fieldName].value;

			const validationError = props.validate?.[fieldName]?.(value);
			_setErrors((prev) => ({
				...prev,
				[fieldName]: validationError || null,
			}));
		};
	}

	function handleSubmit() {
		console.log("handleSubmit");

		const fields = Object.keys(fieldRefs.current);
		const newErrors: Record<string, FieldError> = {};
		const data: Record<string, unknown> = {};

		for (const fieldName of fields) {
			const value = fieldStates.current[fieldName].value;
			data[fieldName] = value;
		}

		let hasErrors = false;
		for (const fieldName of fields) {
			const value = fieldStates.current[fieldName].value;
			const validationResult = props.validate?.[fieldName]?.(value);
			if (validationResult) {
				hasErrors = true;
				newErrors[fieldName] = validationResult;
			} else {
				newErrors[fieldName] = null;
			}
		}

		if (hasErrors) {
			setErrors(newErrors);
			return;
		}

		props.onSubmit(data);
	}

	function register(fieldName: string) {
		if (!fieldStates.current[fieldName]) {
			const defaultValue = props.defaultValues?.[fieldName];
			fieldStates.current[fieldName] = {
				value: defaultValue,
				isTouched: false,
			};
		}

		if (!fieldRefs.current[fieldName]) {
			fieldRefs.current[fieldName] = createRef();
		}

		return {
			name: fieldName,
			ref: fieldRefs.current[fieldName] as RefObject<any>,
			error: errors[fieldName],
			defaultValue: props.defaultValues?.[fieldName],
			onBlur: getHandleBlur(fieldName),
			onChange: getHandleChange(fieldName),
		};
	}

	function setErrors(newErrors: Record<string, FieldError>) {
		const allFields = Object.keys(fieldRefs.current);
		const invalidFields = Object.entries(newErrors)
			.filter((keyval) => !!keyval[1])
			.map((keyval) => keyval[0]);

		const firstInvalidField = allFields.find((f) => invalidFields.includes(f));
		if (firstInvalidField) {
			// fieldRefs.current[firstInvalidField]?.current?.focus();
		}

		_setErrors((prev) => ({
			...prev,
			...newErrors,
		}));
	}
	console.log("useForm");

	const Field = useCallback(function Field({
		name,
		children,
	}: {
		name: string;
		children: (props: {
			ref: RefObject<any>;
			name: string;
			defaultValue?: any;
			handleChange: (value: unknown) => void;
			handleBlur: () => void;
		}) => ReactNode;
	}) {
		console.log("Field", name);

		const defaultValue = props.defaultValues?.[name];

		if (!fieldStates.current[name]) {
			fieldStates.current[name] = {
				value: defaultValue,
				isTouched: false,
			};

			fieldRefs.current[name] = createRef();
			initializedFields.current[name] = true;
		}

		return children({
			ref: fieldRefs.current[name],
			name: name,
			defaultValue,
			handleChange: getHandleChange(name),
			handleBlur: getHandleBlur(name),
		});
	}, []);

	return {
		register,
		errors,
		setErrors,
		handleSubmit,
		Field,
	};
}

export type FormFieldProps = ReturnType<ReturnType<typeof useForm>["register"]>;
