/**
 * Shared constants: colour palette, poll defaults, long-press threshold.
 * Always import these rather than hardcoding hex values or timing numbers.
 */

export const COLOUR_ONLINE = '#4CAF50';
export const COLOUR_DEGRADED = '#FF9800';
export const COLOUR_OFFLINE = '#F44336';
export const COLOUR_DISABLED = '#616161';
export const COLOUR_WORKING = '#2196F3';
export const COLOUR_RECONNECTING = '#2196F3';
export const COLOUR_BG = '#1a1a2e';
export const COLOUR_TEXT = '#ffffff';
export const COLOUR_TRACK = '#333344';

/** Default poll intervals in seconds. */
export const DEFAULT_STATUS_POLL_SECONDS = 5;
export const DEFAULT_STATS_POLL_SECONDS = 10;

/** Long-press threshold in milliseconds. */
export const LONG_PRESS_MS = 600;

/** HTTP request timeout in milliseconds. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Failure threshold before a server is marked unreachable. */
export const FAILURE_THRESHOLD = 3;

/** Exponential backoff schedule in seconds, capped at the last value. */
export const BACKOFF_SCHEDULE_SECONDS = [5, 10, 20, 40, 60];

/** How long an action-error flash stays on a button. */
export const ERROR_FLASH_MS = 3000;
