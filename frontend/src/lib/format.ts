const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    });
    currencyFormatters.set(currency, formatter);
  }
  return formatter;
}

function minorDivisor(currency: string): number {
  return (
    10 ** currencyFormatter(currency).resolvedOptions().maximumFractionDigits
  );
}

export function formatAmount(amount: number, currency: string): string {
  return currencyFormatter(currency).format(amount / minorDivisor(currency));
}

const signedFormatters = new Map<string, Intl.NumberFormat>();

function signedFormatter(currency: string): Intl.NumberFormat {
  let formatter = signedFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      signDisplay: "always",
    });
    signedFormatters.set(currency, formatter);
  }
  return formatter;
}

export function formatMinor(
  amount: number,
  currency: string,
  sign = false,
): string {
  const formatter = sign
    ? signedFormatter(currency)
    : currencyFormatter(currency);
  return formatter.format(amount / minorDivisor(currency));
}

const wholeFormatters = new Map<string, Intl.NumberFormat>();

function wholeFormatter(currency: string): Intl.NumberFormat {
  let formatter = wholeFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
    wholeFormatters.set(currency, formatter);
  }
  return formatter;
}

export function formatWhole(amount: number, currency: string): string {
  return wholeFormatter(currency).format(amount / minorDivisor(currency));
}

const percentFmt = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
  signDisplay: "always",
});

export function formatPercent(value: number): string {
  return percentFmt.format(value);
}

const shortDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const longDateFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatListDate(iso: string): string {
  const date = new Date(iso);
  return date.getFullYear() === new Date().getFullYear()
    ? shortDateFmt.format(date)
    : longDateFmt.format(date);
}
