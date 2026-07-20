import {
  InboxArrowDownIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { Fragment } from "react";
import { Link } from "wouter";

import {
  useCategorizeInboxMutation,
  useInfiniteInboxQuery,
  type InboxItem,
} from "../../api/inbox";
import { Filterbar } from "../../lib/list-shell/filterbar";
import {
  CloseButton,
  FloatingBarWrap,
  SelectionCountButton,
} from "../../lib/list-shell/floating-bar";
import {
  ListEmptyState,
  listEmptyActionClassName,
} from "../../lib/list-shell/list-empty-state";
import { ListSkeleton } from "../../lib/list-shell/list-skeleton";
import {
  useSelection,
  type UseSelectionReturn,
} from "../../lib/list-shell/selection";
import { setSearchParam, useSearchParam } from "../../lib/search-param";
import { UndoNotice } from "../../lib/undo/undo";
import { Checkbox } from "../../ui/checkbox/checkbox";
import { BucketPicker } from "../buckets/bucket-picker";
import { useI18n } from "../i18n/use-i18n";
import { BucketComboRoot, BucketComboTrigger } from "./bucket-combo";
import { InboxUndoProvider } from "./inbox-undo";
import { useInboxUndo } from "./inbox-undo-context";
import {
  MatchTransactions,
  useMatchTransactions,
} from "./match-transactions-dialog";

export default function InboxPage() {
  const selection = useSelection();

  return (
    <InboxUndoProvider selection={selection}>
      <InboxPageContent selection={selection} />
    </InboxUndoProvider>
  );
}

function InboxPageContent(props: { selection: UseSelectionReturn }) {
  const searchQuery = useSearchParam("q");
  const selection = props.selection;
  const inboxQuery = useInfiniteInboxQuery({ searchQuery });
  const inboxItems = inboxQuery.data?.pages.flatMap((p) => p.rows) ?? [];
  const visibleIds = inboxItems.map((item) => item.id);
  const allVisibleSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => selection.selected.has(id));

  return (
    <div>
      <Filterbar
        selectLabel="Select rows"
        selectMode={selection.selectMode}
        onSelectMode={(on) =>
          on ? selection.setSelectMode(true) : selection.exitSelect()
        }
        allVisibleSelected={allVisibleSelected}
        onToggleAll={() =>
          allVisibleSelected
            ? selection.drop(visibleIds)
            : selection.select(visibleIds)
        }
        search={searchQuery || undefined}
        onSearch={(value) => setSearchParam("q", value, { replace: true })}
      />

      <MatchTransactions>
        <List
          selection={selection}
          searchQuery={searchQuery}
          inboxQuery={inboxQuery}
          inboxItems={inboxItems}
          visibleIds={visibleIds}
        />
      </MatchTransactions>

      <FloatingBar selection={selection} />

      <UndoNotice raised={selection.selectMode} />
    </div>
  );
}

function List(props: {
  selection: UseSelectionReturn;
  searchQuery: string | null;
  inboxQuery: ReturnType<typeof useInfiniteInboxQuery>;
  inboxItems: InboxItem[];
  visibleIds: string[];
}) {
  const { f, isLoading: i18nLoading, isError: i18nError } = useI18n();
  const matchContext = useMatchTransactions();

  if (props.inboxQuery.isLoading || i18nLoading) {
    return <ListSkeleton />;
  }
  if (props.inboxQuery.isError || i18nError) {
    return (
      <p className="mx-auto w-full max-w-(--page-width) px-3 sm:px-6">
        error loading inbox
      </p>
    );
  }

  let prevDate: string | null = null;

  const currentYear = new Date().getFullYear();
  const formatDate = (value: string) => {
    const date = new Date(value);
    return currentYear === date.getFullYear()
      ? f.shortDate(date)
      : f.longDate(date);
  };

  return (
    <BucketComboRoot onMatchAction={matchContext.openMatchingTo}>
      {props.inboxItems.length ? (
        <ul
          className={`-mt-1 flex list-none flex-col ${props.selection.selectMode ? "select-none" : ""}`}
        >
          {props.inboxItems.map((item) => {
            const dateFormatted = formatDate(item.date);
            const showDateHeader = dateFormatted !== prevDate;
            prevDate = dateFormatted;

            return (
              <Fragment key={item.id}>
                {showDateHeader && (
                  <li
                    role="presentation"
                    className="sticky -top-1 z-1 text-base text-gray-700 [&+li>*]:border-t-0 sm:top-[calc(var(--nav-height)+var(--filterbar-height)-var(--spacing))]"
                  >
                    <h2 className="mx-auto my-1 max-w-(--page-width) bg-gray-125 px-3 py-1 text-2xs font-medium sm:rounded-lg sm:px-6">
                      {dateFormatted}
                    </h2>
                  </li>
                )}

                <Item
                  item={item}
                  selection={props.selection}
                  visibleIds={props.visibleIds}
                />
              </Fragment>
            );
          })}
        </ul>
      ) : props.searchQuery ? (
        <ListEmptyState
          icon={MagnifyingGlassIcon}
          heading="No matching inbox items"
          body="Try adjusting your search to find what you’re looking for."
          secondaryAction={
            <button
              type="button"
              className={`${listEmptyActionClassName} text-gray-900 hover:bg-gray-200`}
              onClick={() => setSearchParam("q", undefined, { replace: true })}
            >
              Clear search
            </button>
          }
        />
      ) : (
        <ListEmptyState
          icon={InboxArrowDownIcon}
          heading="No transactions to categorize"
          body="Imported transactions that need categorizing will appear here."
          primaryAction={
            <Link
              href="/imports"
              className={`${listEmptyActionClassName} bg-success-solid text-white hover:bg-success-solid-hover`}
            >
              Import transactions
            </Link>
          }
        />
      )}
    </BucketComboRoot>
  );
}

function Item(props: {
  item: InboxItem;
  selection: UseSelectionReturn;
  visibleIds: string[];
}) {
  const itemId = props.item.id;
  const { f } = useI18n();

  return (
    <li className="mx-auto w-full max-w-(--page-width) px-3 sm:px-6">
      <div
        className={`relative border-t border-gray-200 ${props.selection.selectMode ? "cursor-pointer" : ""}`}
        onClick={(event) => {
          if (!props.selection.selectMode) return;
          if (event.shiftKey)
            props.selection.selectThrough(itemId, props.visibleIds);
          else props.selection.toggle(itemId);
        }}
      >
        <div
          className={`pointer-events-none absolute start-0 top-1/2 flex -translate-y-1/2 transition-opacity duration-220 ease-[cubic-bezier(.25,.8,.25,1)] motion-reduce:duration-[1ms] ${props.selection.selectMode ? "opacity-100" : "opacity-0"}`}
        >
          <Checkbox
            checked={props.selection.selected.has(itemId)}
            tabIndex={-1}
            style={{ pointerEvents: "none" }}
            readOnly
          />
        </div>
        <div
          className={`flex contain-layout transition-[padding-inline-start] duration-220 ease-[cubic-bezier(.25,.8,.25,1)] motion-reduce:duration-[1ms] ${props.selection.selectMode ? "ps-8 [&_:where(button,a)]:pointer-events-none" : ""}`}
        >
          <BucketComboTrigger
            rowId={itemId}
            className="-mx-3 grid min-w-0 flex-1 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-lg bg-transparent px-3 py-2 text-start font-[inherit] text-inherit outline-[1.5px] outline-transparent outline-offset-[-1.5px] hover:bg-gray-150 focus-visible:outline-(--input-ring-active) data-popup-open:bg-gray-150"
          >
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-base font-medium text-gray-1000">
              {props.item.counterparty || "—"}
            </span>
            <span
              className={`text-end whitespace-nowrap text-base font-medium ${props.item.amount >= 0 ? "text-success-fg" : "text-gray-1000"}`}
            >
              {f.amount(props.item.amount, props.item.currency)}
            </span>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-gray-700">
              {props.item.description}
            </span>
            <span className="text-end whitespace-nowrap text-sm text-gray-700">
              {props.item.account}
            </span>
          </BucketComboTrigger>
        </div>
      </div>
    </li>
  );
}

function FloatingBar(props: { selection: UseSelectionReturn }) {
  const categorize = useCategorizeInboxMutation();
  const undo = useInboxUndo();

  return (
    <FloatingBarWrap show={props.selection.selectMode}>
      <SelectionCountButton
        count={props.selection.selected.size}
        onClick={props.selection.clearSelection}
      />
      <div className="min-w-0 flex-1">
        <BucketPicker
          kinds={["expense", "income", "person"]}
          createKinds={["expense", "income", "person"]}
          value={null}
          placeholder="Category or person"
          onPick={(bucket) => {
            const ids = [...props.selection.selected];
            void undo.run(
              ids,
              `Categorized ${ids.length} transaction${ids.length === 1 ? "" : "s"}`,
              () =>
                categorize.mutateAsync({
                  rowIds: ids,
                  target: { type: "bucket", bucketId: bucket.id },
                }),
            );
            props.selection.exitSelect();
          }}
        />
      </div>
      <CloseButton onClick={props.selection.exitSelect} />
    </FloatingBarWrap>
  );
}
