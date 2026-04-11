/**
 * Shared formatting helpers for display values.
 * Proxmox returns raw bytes / seconds / 0-1 floats — these turn them
 * into the short strings we render on buttons.
 */

/** Percent 0-100 from a 0-1 fraction, rounded. */
export function fractionToPct(fraction) {
	if (fraction == null || Number.isNaN(fraction)) return 0;
	return Math.max(0, Math.min(100, Math.round(fraction * 100)));
}

/** Percent from used / total. Returns 0 if total is 0. */
export function ratioToPct(used, total) {
	if (!total || Number.isNaN(used)) return 0;
	return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

/** Bytes → short human string (e.g. "3.2G", "512M"). */
export function bytesShort(bytes) {
	if (bytes == null || Number.isNaN(bytes)) return '—';
	const units = ['B', 'K', 'M', 'G', 'T'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
	return value.toFixed(precision) + units[unit];
}

/** Bytes per second → Mbps short string (e.g. "42.3"). */
export function bytesPerSecToMbps(bps) {
	if (bps == null || Number.isNaN(bps) || bps < 0) return 0;
	return Math.round((bps * 8) / 1_000_000 * 10) / 10;
}

/** Bytes per second → MB/s short string (e.g. "12.4"). */
export function bytesPerSecToMBs(bps) {
	if (bps == null || Number.isNaN(bps) || bps < 0) return 0;
	return Math.round((bps / 1_000_000) * 10) / 10;
}

/** Integer seconds → "Xd Xh Xm". */
export function uptimeShort(seconds) {
	if (seconds == null || Number.isNaN(seconds) || seconds < 0) return '—';
	const s = Math.floor(seconds);
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

/** Truncate a string to `max` chars, appending an ellipsis if cut. */
export function truncate(str, max) {
	if (!str) return '';
	return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
