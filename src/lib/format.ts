const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  month: "long",
  day: "numeric",
  year: "numeric"
});

export function formatCurrency(value: number, digits = 2) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

export function formatRoundedAnnual(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value)}/year`;
}

export function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

export function formatDateTime(value: string) {
  return dateFormatter.format(new Date(value));
}

export function formatStorage(gb: number) {
  if (gb >= 1000) {
    return `${(gb / 1000).toFixed(gb % 1000 === 0 ? 0 : 1)} TB`;
  }

  return `${gb} GB`;
}

export function formatUserRange(rangeDescription: string) {
  return rangeDescription.replace(/\b(\d{4,})\b/g, (match) => {
    const number = Number(match);
    if (number < 10000) {
      return match;
    }

    return new Intl.NumberFormat("en-US").format(number);
  });
}

export function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

export function formatRoleLabel(role: string) {
  return role
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
