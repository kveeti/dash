import { PlusIcon, ValueIcon } from "@radix-ui/react-icons";
import { ComponentProps } from "react";

export function IconCircle(props: ComponentProps<typeof PlusIcon>) {
	return <ValueIcon {...props} />;
}
