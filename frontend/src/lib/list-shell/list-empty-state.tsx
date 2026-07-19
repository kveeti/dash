import type { ComponentType, ReactNode, SVGProps } from "react";

export type ListEmptyStateIcon = ComponentType<SVGProps<SVGSVGElement>>;

export function ListEmptyState(props: {
  icon: ListEmptyStateIcon;
  heading: string;
  body: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  const Icon = props.icon;

  return (
    <section className="mx-auto mt-8 flex w-full max-w-(--page-width) flex-col items-center rounded-2xl bg-form px-3 py-24 text-center sm:px-6">
      <Icon className="mb-4 size-10 text-gray-500" aria-hidden="true" />
      <h2 className="text-base font-medium text-gray-950">{props.heading}</h2>
      <p className="mt-1 max-w-md text-sm text-gray-700">{props.body}</p>
      {(props.primaryAction || props.secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {props.primaryAction}
          {props.secondaryAction}
        </div>
      )}
    </section>
  );
}

export const listEmptyActionClassName =
  "inline-flex min-h-9 items-center justify-center rounded-xl px-4 py-2 text-sm font-medium outline-offset-2 focus-visible:outline-2 focus-visible:outline-gray-500";
