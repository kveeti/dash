/* eslint-disable @typescript-eslint/no-explicit-any -- types are tbd */
import { type ComponentProps } from "react";
import { type ComponentType, createElement, lazy, useRef } from "react";

export type PreloadableComponent<T extends ComponentType<any>> = T & {
	preload: () => Promise<T>;
};

export function lazyWithPreload<T extends ComponentType<any>>(
	factory: () => Promise<{ default: T }>,
): PreloadableComponent<T> {
	const ReactLazyComponent = lazy(factory);
	let PreloadedComponent: T | undefined;
	let factoryPromise: Promise<T> | undefined;

	const Component = function LazyWithPreload(props: ComponentProps<T>) {
		const ComponentToRender = useRef(PreloadedComponent ?? ReactLazyComponent);
		return createElement(ComponentToRender.current, props);
	};

	const LazyWithPreload = Component as any as PreloadableComponent<T>;

	LazyWithPreload.preload = () => {
		if (!factoryPromise) {
			factoryPromise = factory().then((module) => {
				PreloadedComponent = module.default;
				return PreloadedComponent;
			});
		}

		return factoryPromise;
	};

	return LazyWithPreload;
}
