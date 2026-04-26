import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "wouter";
import { Button } from "../../components/button";
import { Empty } from "../../components/empty";
import { type SelectedTxHandle } from "../../components/selected-tx";
import { SelectedTxWindow } from "../../components/selected-tx-window";
import { Spinner } from "../../components/spinner";
import { Select } from "../../components/select";
import { useI18n } from "../../providers";
import {
	useDismissTransactionLinkSuggestionMutation,
	useCreateTransactionFlowMutation,
	type TransactionLinkSuggestion,
	useTransactionLinkSuggestionPageQuery,
} from "../../lib/queries/transactions";

type SuggestionFilter = "all" | TransactionLinkSuggestion["kind"];
const AUTO_SCAN_TARGET_SUGGESTIONS = 60;
const AUTO_SCAN_MAX_TRANSACTIONS = 1_000;

function suggestionLabel(kind: TransactionLinkSuggestion["kind"]) {
	switch (kind) {
		case "transfer_pair":
			return "own transfer";
		case "refund_group":
			return "refund";
	}
}

function confidenceLabel(confidence: TransactionLinkSuggestion["confidence"]) {
	return confidence === "high" ? "high" : "review";
}

export function LinkSuggestionsPage() {
	const { f } = useI18n();
	const [searchParams] = useSearchParams();
	const [, navigate] = useLocation();
	const filterParam = searchParams.get("kind");
	const filter: SuggestionFilter =
		filterParam === "transfer_pair" ||
		filterParam === "refund_group"
			? filterParam
			: "all";
	const highOnly = searchParams.get("high") === "1";
	const beforeDate = searchParams.get("before_date") ?? undefined;
	const beforeId = searchParams.get("before_id") ?? undefined;
	const initialCursor =
		beforeDate && beforeId
			? { beforeDate, beforeId }
			: undefined;
	const suggestionsQuery = useTransactionLinkSuggestionPageQuery(initialCursor);
	const createFlowMutation = useCreateTransactionFlowMutation();
	const dismissMutation = useDismissTransactionLinkSuggestionMutation();
	const isMutating = createFlowMutation.isPending || dismissMutation.isPending;
	const [openTxIds, setOpenTxIds] = useState<Array<string>>([]);
	const [manualScanUntilCount, setManualScanUntilCount] = useState<number | null>(
		null,
	);
	const windowRefs = useRef<Map<string, SelectedTxHandle>>(new Map());

	const loadedSuggestions = useMemo(() => {
		const byId = new Map<string, TransactionLinkSuggestion>();
		for (const page of suggestionsQuery.data?.pages ?? []) {
			for (const suggestion of page.suggestions) {
				byId.set(suggestion.id, suggestion);
			}
		}
		return [...byId.values()].sort((a, b) => b.score - a.score);
	}, [suggestionsQuery.data]);
	const totalScannedCount =
		suggestionsQuery.data?.pages.reduce(
			(total, page) => total + page.scanned_count,
			0,
		) ?? 0;
	const nextCursor =
		suggestionsQuery.data?.pages.at(-1)?.next_cursor ?? null;

	function openTxWindow(txId: string) {
		if (openTxIds.includes(txId)) {
			windowRefs.current.get(txId)?.nudge();
			return;
		}
		setOpenTxIds((prev) => [...prev, txId]);
	}

	function closeTxWindow(txId: string) {
		setOpenTxIds((prev) => prev.filter((id) => id !== txId));
	}

	function setWindowRef(id: string, handle: SelectedTxHandle | null) {
		if (handle) windowRefs.current.set(id, handle);
		else windowRefs.current.delete(id);
	}

	function setParams(updates: Record<string, string | undefined>) {
		const params = new URLSearchParams(searchParams.toString());
		for (const [key, value] of Object.entries(updates)) {
			if (value) params.set(key, value);
			else params.delete(key);
		}
		const qs = params.toString();
		navigate(qs ? `/txs/link-suggestions?${qs}` : "/txs/link-suggestions");
	}

	function setFilter(next: SuggestionFilter) {
		setParams({
			kind: next === "all" ? undefined : next,
			before_date: undefined,
			before_id: undefined,
		});
	}

	function setHighOnly(next: boolean) {
		setParams({
			high: next ? "1" : undefined,
			before_date: undefined,
			before_id: undefined,
		});
	}

	function loadOlder() {
		if (!suggestionsQuery.hasNextPage) return;
		setManualScanUntilCount(totalScannedCount + AUTO_SCAN_MAX_TRANSACTIONS);
	}

	function resetToNewest() {
		setParams({
			before_date: undefined,
			before_id: undefined,
		});
	}

	const filteredSuggestions = useMemo(() => {
		return loadedSuggestions.filter((suggestion) => {
			if (filter !== "all" && suggestion.kind !== filter) return false;
			if (highOnly && suggestion.confidence !== "high") return false;
			return true;
		});
	}, [loadedSuggestions, filter, highOnly]);
	const highSuggestions = filteredSuggestions.filter(
		(suggestion) => suggestion.confidence === "high",
	);
	const reviewSuggestions = filteredSuggestions.filter(
		(suggestion) => suggestion.confidence !== "high",
	);
	const bulkOwnTransfers = filteredSuggestions.filter(
		(suggestion) =>
			suggestion.kind === "transfer_pair" && suggestion.confidence === "high",
	);
	const autoScanStoppedAtLimit =
		totalScannedCount >= AUTO_SCAN_MAX_TRANSACTIONS &&
		!!nextCursor &&
		filteredSuggestions.length < AUTO_SCAN_TARGET_SUGGESTIONS;
	const manualScanIsActive =
		manualScanUntilCount !== null &&
		totalScannedCount < manualScanUntilCount;
	const manualScanStoppedAtLimit =
		manualScanUntilCount !== null &&
		totalScannedCount >= manualScanUntilCount &&
		!!nextCursor;
	const shouldContinueAutoScan =
		!suggestionsQuery.isError &&
		!suggestionsQuery.isFetching &&
		!!nextCursor &&
		(manualScanIsActive ||
			(filteredSuggestions.length < AUTO_SCAN_TARGET_SUGGESTIONS &&
				totalScannedCount < AUTO_SCAN_MAX_TRANSACTIONS));
	const isScanning =
		suggestionsQuery.isLoading ||
		suggestionsQuery.isFetchingNextPage ||
		shouldContinueAutoScan;

	useEffect(() => {
		if (!shouldContinueAutoScan || !suggestionsQuery.hasNextPage) return;

		suggestionsQuery.fetchNextPage();
	}, [shouldContinueAutoScan, suggestionsQuery]);

	async function acceptSuggestion(suggestion: TransactionLinkSuggestion) {
		for (const flow of suggestion.suggested_flows) {
			await createFlowMutation.mutateAsync(flow);
		}
	}

	function dismissSuggestion(suggestion: TransactionLinkSuggestion) {
		dismissMutation.mutate({
			kind: suggestion.kind,
			primaryTransactionId: suggestion.primary_transaction_id,
			candidateIds: suggestion.transaction_ids.filter(
				(id) => id !== suggestion.primary_transaction_id,
			),
		});
	}

	return (
		<div className="space-y-4 max-w-180 w-full mx-auto pt-14 px-3 pb-24">
			<h1 className="font-medium text-2xl font-cool">link suggestions</h1>

			<div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
				<div className="flex gap-2">
					<Select
						size="sm"
						value={filter}
						onChange={(e) => setFilter(e.currentTarget.value as SuggestionFilter)}
					>
						<option value="all">all</option>
						<option value="transfer_pair">own transfers</option>
						<option value="refund_group">refunds</option>
					</Select>
					<label className="border-gray-a4 bg-gray-1 flex h-8 items-center gap-2 border px-2 text-sm">
						<input
							type="checkbox"
							checked={highOnly}
							onChange={(e) => setHighOnly(e.currentTarget.checked)}
						/>
						high only
					</label>
				</div>
				<div className="flex gap-1">
					<Button
						size="sm"
						variant="ghost"
						onClick={resetToNewest}
						disabled={!beforeDate || !beforeId}
					>
						newest
					</Button>
				</div>
			</div>

			<ScanStatus
				autoScanStoppedAtLimit={autoScanStoppedAtLimit}
				hasNextPage={suggestionsQuery.hasNextPage}
				isMutating={isMutating}
				isScanning={isScanning}
				manualScanStoppedAtLimit={manualScanStoppedAtLimit}
				nextCursorExists={!!nextCursor}
				onLoadOlder={loadOlder}
				suggestionCount={filteredSuggestions.length}
				totalScannedCount={totalScannedCount}
			/>

			{suggestionsQuery.isError ? (
				<Empty>failed to load suggestions</Empty>
			) :  (
				<div className="space-y-5">
					{filteredSuggestions.length ? (
						<SuggestionSections
							highSuggestions={highSuggestions}
							isCreatePending={createFlowMutation.isPending}
							isMutating={isMutating}
							onAccept={acceptSuggestion}
							onDismiss={dismissSuggestion}
							onOpenTx={openTxWindow}
							reviewSuggestions={reviewSuggestions}
							formatAmount={f.amount}
						/>
					) : (
						<Empty>no link suggestions in this scan</Empty>
					)}
					<PaginationFooter
						nextCursorExists={!!nextCursor}
						totalScannedCount={totalScannedCount}
					/>
				</div>
			)}

			{openTxIds.map((id, index) => (
				<SelectedTxWindow
					key={id}
					txId={id}
					index={index}
					onClose={() => closeTxWindow(id)}
					ref={(handle) => setWindowRef(id, handle)}
				/>
			))}
		</div>
	);
}

function PaginationFooter({
	nextCursorExists,
	totalScannedCount,
}: {
	nextCursorExists: boolean;
	totalScannedCount: number;
}) {
	if (!nextCursorExists && !totalScannedCount) return null;

	return (
		<div className="flex items-center justify-between gap-3 pt-2">
			<p className="text-xs text-gray-10">
				scanned {totalScannedCount} transaction
				{totalScannedCount === 1 ? "" : "s"}
			</p>
		</div>
	);
}

function ScanStatus({
	autoScanStoppedAtLimit,
	hasNextPage,
	isMutating,
	isScanning,
	manualScanStoppedAtLimit,
	nextCursorExists,
	onLoadOlder,
	suggestionCount,
	totalScannedCount,
}: {
	autoScanStoppedAtLimit: boolean;
	hasNextPage: boolean;
	isMutating: boolean;
	isScanning: boolean;
	manualScanStoppedAtLimit: boolean;
	nextCursorExists: boolean;
	onLoadOlder: () => void;
	suggestionCount: number;
	totalScannedCount: number;
}) {
	let label = "scan complete";
	if (isScanning) label = "scanning older transactions";
	else if (autoScanStoppedAtLimit || manualScanStoppedAtLimit) label = "scan paused";
	else if (!nextCursorExists && totalScannedCount > 0) label = "all older transactions scanned";

	return (
		<div className="border-gray-a4 bg-gray-1 flex items-center justify-between gap-3 border px-3 py-2">
			<div className="min-w-0">
				<p className="text-sm">{label}</p>
				<p className="text-xs text-gray-10">
					scanned {totalScannedCount} transaction
					{totalScannedCount === 1 ? "" : "s"} · found {suggestionCount}{" "}
					suggestion{suggestionCount === 1 ? "" : "s"}
				</p>
			</div>
			<div className="shrink-0">
				{isScanning ? (
					<Spinner />
				) : nextCursorExists ? (
					<Button
						size="sm"
						variant="ghost"
						onClick={onLoadOlder}
						disabled={!hasNextPage || isMutating}
					>
						{autoScanStoppedAtLimit || manualScanStoppedAtLimit
							? "continue scan"
							: "load older"}
					</Button>
				) : null}
			</div>
		</div>
	);
}

function SuggestionSections({
	formatAmount,
	highSuggestions,
	isCreatePending,
	isMutating,
	onAccept,
	onDismiss,
	onOpenTx,
	reviewSuggestions,
}: {
	formatAmount: (amount: number, currency: string) => string;
	highSuggestions: TransactionLinkSuggestion[];
	isCreatePending: boolean;
	isMutating: boolean;
	onAccept: (suggestion: TransactionLinkSuggestion) => void;
	onDismiss: (suggestion: TransactionLinkSuggestion) => void;
	onOpenTx: (txId: string) => void;
	reviewSuggestions: TransactionLinkSuggestion[];
}) {
	return (
		<>
			{highSuggestions.length > 0 && (
				<section className="space-y-2">
					<h2 className="text-sm font-medium">high confidence</h2>
					<ul className="space-y-3">
						{highSuggestions.map((suggestion) => (
							<SuggestionItem
								key={suggestion.id}
								formatAmount={formatAmount}
								isCreatePending={isCreatePending}
								isMutating={isMutating}
								onAccept={onAccept}
								onDismiss={onDismiss}
								onOpenTx={onOpenTx}
								suggestion={suggestion}
							/>
						))}
					</ul>
				</section>
			)}
			{reviewSuggestions.length > 0 && (
				<section className="space-y-2">
					<h2 className="text-sm font-medium">review</h2>
					<ul className="space-y-3">
						{reviewSuggestions.map((suggestion) => (
							<SuggestionItem
								key={suggestion.id}
								formatAmount={formatAmount}
								isCreatePending={isCreatePending}
								isMutating={isMutating}
								onAccept={onAccept}
								onDismiss={onDismiss}
								onOpenTx={onOpenTx}
								suggestion={suggestion}
							/>
						))}
					</ul>
				</section>
			)}
		</>
	);
}

function SuggestionItem({
	formatAmount,
	isCreatePending,
	isMutating,
	onAccept,
	onDismiss,
	onOpenTx,
	suggestion,
}: {
	formatAmount: (amount: number, currency: string) => string;
	isCreatePending: boolean;
	isMutating: boolean;
	onAccept: (suggestion: TransactionLinkSuggestion) => void;
	onDismiss: (suggestion: TransactionLinkSuggestion) => void;
	onOpenTx: (txId: string) => void;
	suggestion: TransactionLinkSuggestion;
}) {
	const primary = suggestion.transactions.find(
		(tx) => tx.id === suggestion.primary_transaction_id,
	);
	const candidates = suggestion.transactions.filter(
		(tx) => tx.id !== suggestion.primary_transaction_id,
	);
	if (!primary || candidates.length === 0) return null;

	return (
		<li className="border-gray-a4 border p-3 space-y-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-sm">
						{suggestionLabel(suggestion.kind)} ·{" "}
						<span className="text-gray-10">
							{confidenceLabel(suggestion.confidence)} · {Math.round(suggestion.score)}
						</span>
					</p>
					<button
						type="button"
						onClick={() => onOpenTx(primary.id)}
						className="block truncate font-medium hover:underline text-left"
					>
						{primary.counter_party}
					</button>
					<p className="text-xs text-gray-10">
						{primary.date.slice(0, 10)} · {primary.account_name} ·{" "}
						{formatAmount(primary.amount, primary.currency)}
					</p>
				</div>
				<div className="flex gap-1 shrink-0">
					<Button
						size="sm"
						onClick={() => onAccept(suggestion)}
						disabled={isMutating}
						isLoading={isCreatePending}
					>
						link
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => onDismiss(suggestion)}
						disabled={isMutating}
					>
						dismiss
					</Button>
				</div>
			</div>

			<ul className="text-xs space-y-1">
				{candidates.map((candidate) => (
					<li key={candidate.id} className="flex justify-between gap-2">
						<button
							type="button"
							onClick={() => onOpenTx(candidate.id)}
							className="truncate hover:underline text-left"
						>
							{candidate.date.slice(0, 10)} · {candidate.account_name} ·{" "}
							{candidate.counter_party}
						</button>
						<span className="text-gray-10 shrink-0">
							{formatAmount(candidate.amount, candidate.currency)}
						</span>
					</li>
				))}
			</ul>

			<p className="text-xs text-gray-10">{suggestion.evidence.join(", ")}</p>
		</li>
	);
}
