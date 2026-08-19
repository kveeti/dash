import { BeakerIcon } from "@heroicons/react/24/outline";
import { useState, type ReactNode } from "react";

import { ListEmptyState } from "../../lib/list-shell/list-empty-state";
import { AlertDialog } from "../../ui/alert-dialog/alert-dialog";
import { createAlertDialogHandle } from "../../ui/alert-dialog/alert-dialog-handle";
import { AnimatedHeight } from "../../ui/animated-height/animated-height";
import { Button, type ButtonVariant } from "../../ui/button/button";
import { Checkbox } from "../../ui/checkbox/checkbox";
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog/dialog";
import { Field, InputGroup } from "../../ui/input/field";
import { FileInput } from "../../ui/input/file-input";
import { Input } from "../../ui/input/input";
import { Select } from "../../ui/input/select";

const alertDialogHandle = createAlertDialogHandle();
const buttonVariants: ButtonVariant[] = [
  "primary",
  "outline",
  "ghost",
  "destructive",
];

export default function DesignPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-3 pb-[calc(var(--nav-height)+2rem)] sm:px-6 sm:pb-12">
      <Section
        title="Typography"
        description="The type sizes used throughout the app."
      >
        <div className="grid gap-4 rounded-2xl bg-form p-4 sm:grid-cols-2">
          <div>
            <span className="text-xs text-gray-600">Title</span>
            <p className="text-xl font-semibold text-gray-1000">
              Monthly overview
            </p>
          </div>
          <div>
            <span className="text-xs text-gray-600">Heading</span>
            <p className="text-md font-semibold text-gray-950">
              Recent transactions
            </p>
          </div>
          <div>
            <span className="text-xs text-gray-600">Body</span>
            <p className="text-base text-gray-900">
              Groceries at the corner market
            </p>
          </div>
          <div>
            <span className="text-xs text-gray-600">Supporting</span>
            <p className="text-sm text-gray-700">Today at 14:32 · Food</p>
          </div>
        </div>
      </Section>

      <Section
        title="Color"
        description="Semantic surfaces and foreground colors adapt to the system theme."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            ["Canvas", "bg-canvas"],
            ["Form", "bg-form"],
            ["Popover", "bg-popover"],
            ["Success", "bg-success-solid"],
            ["Danger", "bg-danger-surface"],
            ["Selected", "bg-popover-item-selected"],
          ].map(([label, color]) => (
            <div
              key={label}
              className="rounded-xl border border-border-subtle bg-form p-2"
            >
              <div
                className={`h-14 rounded-lg border border-border-subtle ${color}`}
              />
              <p className="mt-2 text-sm text-gray-700">{label}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Buttons"
        description="Primary, secondary, quiet, and destructive actions."
      >
        <div className="flex flex-wrap items-center gap-3">
          {buttonVariants.map((variant) => (
            <Button key={variant} variant={variant} className="capitalize">
              {variant}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title="Checkboxes"
        description="Unchecked, checked, and indeterminate selection states."
      >
        <div className="flex flex-wrap gap-8 rounded-2xl bg-form p-5">
          <label className="flex items-center gap-3 text-sm text-gray-900">
            <Checkbox />
            Unchecked
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-900">
            <Checkbox defaultChecked />
            Checked
          </label>
          <label className="flex items-center gap-3 text-sm text-gray-900">
            <Checkbox indeterminate />
            Indeterminate
          </label>
        </div>
      </Section>

      <Section
        title="Inputs"
        description="Native controls, field labels, grouped controls, and validation."
      >
        <div className="grid gap-5 rounded-2xl bg-form p-4 min-[30rem]:grid-cols-[auto_minmax(0,22rem)] min-[30rem]:items-center min-[30rem]:gap-x-8">
          <Field label="Text">
            <Input placeholder="Counterparty" />
          </Field>
          <Field label="Search">
            <Input type="search" placeholder="Search transactions…" />
          </Field>
          <Field label="Date">
            <Input type="date" defaultValue="2026-03-01" />
          </Field>
          <Field label="Category">
            <Select defaultValue="food">
              <option value="food">Food</option>
              <option value="travel">Travel</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Amount">
            <InputGroup>
              <Input grouped inputMode="decimal" placeholder="0.00" />
              <Select grouped aria-label="Currency" defaultValue="EUR">
                <option>EUR</option>
                <option>USD</option>
                <option>GBP</option>
              </Select>
            </InputGroup>
          </Field>
          <Field label="Statement">
            <FileInput
              aria-label="Statement"
              acceptedFileTypes={[".csv", "text/csv"]}
              allowsMultiple
            />
          </Field>
          <Field label="Invalid field" error="Enter a description">
            <Input placeholder="Description" />
          </Field>
        </div>
      </Section>

      <Section
        title="Animated height"
        description="Content changes are measured and smoothly resized."
      >
        <HeightDemo />
      </Section>

      <Section
        title="Dialog"
        description="A modal surface for focused tasks and information."
      >
        <DialogDemo />
      </Section>

      <Section
        title="Alert dialog"
        description="A modal confirmation for consequential actions."
      >
        <Button
          variant="destructive"
          onClick={() =>
            alertDialogHandle.openWithPayload({
              title: "Delete transaction?",
              description: "This action cannot be undone.",
              confirmLabel: "Delete",
              confirmVariant: "destructive",
              onConfirm: () => undefined,
            })
          }
        >
          Open alert dialog
        </Button>
        <AlertDialog handle={alertDialogHandle} />
      </Section>

      <Section
        title="Empty state"
        description="A reusable blank slate with primary and secondary actions."
      >
        <div className="[&>section]:mt-0 [&>section]:py-12">
          <ListEmptyState
            icon={BeakerIcon}
            heading="Nothing here yet"
            body="Once items are added, they will appear in this list."
            primaryAction={<Button>Add item</Button>}
            secondaryAction={<Button variant="ghost">Learn more</Button>}
          />
        </div>
      </Section>
    </div>
  );
}

function Section(props: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border-subtle py-8 first:border-t-0">
      <div className="mb-5">
        <h2 className="text-md font-semibold text-gray-950">{props.title}</h2>
        <p className="mt-1 text-sm text-gray-700">{props.description}</p>
      </div>
      {props.children}
    </section>
  );
}

function DialogDemo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogBackdrop className="bg-black/10" />
        <DialogPopup className="start-1/2 top-1/2 w-[min(24rem,calc(100vw-1rem))] -translate-y-1/2 gap-4 p-4 text-gray-900">
          <DialogTitle className="text-md font-semibold">
            Example dialog
          </DialogTitle>
          <p className="text-sm text-gray-700">
            A standard dialog can hold focused content without asking for
            confirmation.
          </p>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function HeightDemo() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="max-w-sm rounded-2xl border border-border-subtle bg-form p-4">
      <Button variant="outline" onClick={() => setExpanded((value) => !value)}>
        {expanded ? "Show less" : "Show more"}
      </Button>
      <AnimatedHeight>
        {expanded && (
          <p className="pt-4 text-sm text-gray-700">
            This content changes the height of its container without jumping. It
            is useful for validation messages and expanding details.
          </p>
        )}
      </AnimatedHeight>
    </div>
  );
}
