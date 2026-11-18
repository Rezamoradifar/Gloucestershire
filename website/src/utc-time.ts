const zonedIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// API timestamps must identify an instant even when the browser's zone changes.
export function parseZonedTimestamp(value: unknown): number {
  return typeof value === 'string' && zonedIso.test(value) ? Date.parse(value) : NaN;
}

// Contract timestamps are Unix seconds. Zero is the contract's unset sentinel.
export function formatUtcTime(value: number | string): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return 'Not recorded';
  const date = new Date(typeof value === 'number' ? value * 1000 : parseZonedTimestamp(value));
  if (!Number.isFinite(date.getTime())) return 'Not recorded';
  return date.toISOString().split('.')[0].replace('T', ' ') + ' UTC';
}
