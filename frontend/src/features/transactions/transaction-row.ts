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
      kind: "exchange";
      from: string;
      to: string;
      fromAmount: number;
      fromCurrency: string;
      toAmount: number;
      toCurrency: string;
    }
  | {
      kind: "generic";
      legs: { name: string; amount: number; currency: string }[];
    };

export function formatAmount(amount: number, currency: string): string {
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(amount / 10 ** digits);
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

  const clearingLegs = txn.postings.filter((p) => kind(p) === "clearing");
  const moneyLegs = txn.postings.filter((p) => kind(p) !== "clearing");
  if (
    clearingLegs.length === 2 &&
    moneyLegs.length === 2 &&
    moneyLegs.every((p) => kind(p) === "asset" || kind(p) === "liability") &&
    moneyLegs[0].currency !== moneyLegs[1].currency &&
    moneyLegs.every((money) =>
      clearingLegs.some(
        (clearing) =>
          clearing.currency === money.currency &&
          clearing.amount === -money.amount,
      ),
    )
  ) {
    const neg = moneyLegs.find((p) => p.amount < 0);
    const pos = moneyLegs.find((p) => p.amount > 0);
    if (neg && pos) {
      return {
        kind: "exchange",
        from: name(neg),
        to: name(pos),
        fromAmount: neg.amount,
        fromCurrency: neg.currency,
        toAmount: pos.amount,
        toCurrency: pos.currency,
      };
    }
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
