/**
 * Gauge icons used by every *-stats action (server / node / VM / CT).
 *
 * For percentage parameters (CPU, RAM, disk, storage) we render the 270°
 * arc gauge with a big numeric % value.
 *
 * For non-percentage parameters (uptime, counts, rates) we fall back to a
 * "labelled value" card with a large number and a label.
 */

import {
	COLOUR_DISABLED,
	COLOUR_OFFLINE,
	COLOUR_ONLINE,
	COLOUR_TEXT
} from '../utils/constants.js';
import {
	CENTRE,
	centredText,
	gaugeArc,
	labelledValue,
	marqueeBand,
	wrap
} from './svg-generator.js';

/**
 * Map a percentage → colour: green → amber → red as utilisation climbs.
 */
export function gaugeColour(pct) {
	if (pct >= 90) return COLOUR_OFFLINE;
	if (pct >= 75) return '#FF9800';
	return COLOUR_ONLINE;
}

/**
 * Percent gauge with label (e.g. "CPU", "RAM").
 *
 * The opening of the gauge arc is at the bottom, so the big percentage
 * value sits at the centre of the tile and the parameter label reads
 * just underneath it, inside the opening.
 */
export function buildPercentGauge({ pct, label, frame }) {
	const clamped = Math.max(0, Math.min(100, Math.round(pct)));
	const colour = gaugeColour(clamped);
	return wrap(
		gaugeArc({ pct: clamped, fillColour: colour }) +
		centredText({ text: `${clamped}`, y: 74, fontSize: 44, fill: COLOUR_TEXT }) +
		centredText({ text: '%', x: CENTRE + (clamped === 100 ? 46 : clamped >= 10 ? 38 : 28), y: 58, fontSize: 16, fill: COLOUR_TEXT }) +
		(label ? marqueeBand({ text: label, y: 108, fontSize: 18, weight: 600, frame }) : '')
	);
}

/**
 * Non-percentage value card — used for uptime, counts, and rates.
 * `value` is already formatted, `unit` is an optional short suffix.
 */
export function buildValueCard({ value, unit, label, frame }) {
	const display = unit ? `${value}${unit}` : String(value);
	return wrap(labelledValue({ value: display, label: label ?? '', frame }));
}

/** Offline state for a stats button — greyed-out gauge with "OFFLINE". */
export function buildOfflineGauge({ label, frame }) {
	return wrap(
		gaugeArc({ pct: 0, fillColour: COLOUR_DISABLED }) +
		centredText({ text: 'OFFLINE', y: 72, fontSize: 20, fill: COLOUR_DISABLED }) +
		(label ? marqueeBand({ text: label, y: 108, fontSize: 18, fill: COLOUR_DISABLED, weight: 600, frame }) : '')
	);
}

/** Unconfigured placeholder. */
export function buildUnconfiguredGauge() {
	return wrap(
		gaugeArc({ pct: 0, fillColour: COLOUR_DISABLED }) +
		centredText({ text: '—', y: 72, fontSize: 36, fill: COLOUR_DISABLED }) +
		marqueeBand({ text: 'Not set', y: 108, fontSize: 18, fill: COLOUR_DISABLED, weight: 600 })
	);
}
