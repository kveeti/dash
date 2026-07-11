import type { Bucket } from "../../api/buckets";
import type { Posting, Transaction } from "../../api/transactions";

export type TransactionRow =
  | {
      kind: "simple";
      category: string;
      amount: number;
      currency: string;
      account?: string;
    }
  | {
      kind: "transfer";
      from: string;
      to: string;
      amount: number;
      currency: string;
    }
  | {
      kind: "generic";
      legs: { name: string; amount: number; currency: string }[];
    };

export function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount / 100);
}

export function toTransactionRow(
  txn: Transaction,
  buckets: Map<string, Bucket>,
): TransactionRow {
  const name = (p: Posting) => buckets.get(p.bucket_id)!.name;
  const kind = (p: Posting) => buckets.get(p.bucket_id)!.kind;

  const categoryLegs = txn.postings.filter(
    (p) =>
      kind(p) === "expense" || kind(p) === "income" || kind(p) === "person",
  );
  if (categoryLegs.length === 1) {
    const leg = categoryLegs[0];
    const other =
      txn.postings.length === 2
        ? txn.postings.find((p) => p !== leg)
        : undefined;
    return {
      kind: "simple",
      category: name(leg),
      amount: -leg.amount,
      currency: leg.currency,
      ...(other ? { account: name(other) } : {}),
    };
  }

  if (
    txn.postings.length === 2 &&
    txn.postings.every((p) => kind(p) === "asset" || kind(p) === "liability") &&
    txn.postings[0].currency === txn.postings[1].currency
  ) {
    const neg = txn.postings.find((p) => p.amount < 0)!;
    const pos = txn.postings.find((p) => p.amount > 0)!;
    return {
      kind: "transfer",
      from: name(neg),
      to: name(pos),
      amount: Math.abs(neg.amount),
      currency: neg.currency,
    };
  }

  return {
    kind: "generic",
    legs: txn.postings.map((p) => ({
      name: name(p),
      amount: p.amount,
      currency: p.currency,
    })),
  };
}
