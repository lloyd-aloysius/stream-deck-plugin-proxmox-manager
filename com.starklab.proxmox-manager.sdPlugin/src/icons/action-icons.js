/**
 * Action button icons: start, shutdown, force stop, reboot.
 *
 * Each action has four render states:
 *   - ready     → glyph in the action's colour, active
 *   - disabled  → glyph in grey, non-actionable
 *   - working   → blue pulsing ring overlay (frame-based, tick cycles)
 *   - error     → red flash tint
 */

import {
	COLOUR_DISABLED,
	COLOUR_OFFLINE,
	COLOUR_ONLINE,
	COLOUR_TEXT,
	COLOUR_WORKING
} from '../utils/constants.js';
import {
	CANVAS,
	CENTRE,
	bottomLabel,
	topLabel,
	wrap
} from './svg-generator.js';

const ACTION_COLOURS = {
	start:   COLOUR_ONLINE,
	shutdown:'#FF9800',
	stop:    COLOUR_OFFLINE,
	reboot:  '#2196F3'
};

function glyphColour(kind, state) {
	if (state === 'error') return COLOUR_OFFLINE;
	if (state === 'disabled') return COLOUR_DISABLED;
	return ACTION_COLOURS[kind] ?? COLOUR_TEXT;
}

/** Play triangle — start. */
function startGlyph(colour) {
	return `<polygon points="58,46 58,98 102,72" fill="${colour}"/>`;
}

/** Power circle — shutdown. */
function shutdownGlyph(colour) {
	return (
		`<circle cx="${CENTRE}" cy="74" r="24" fill="none" stroke="${colour}" stroke-width="6"/>` +
		`<path d="M72 54 L72 74" stroke="${colour}" stroke-width="6" stroke-linecap="round"/>` +
		`<rect x="64" y="44" width="16" height="6" fill="#1a1a2e"/>`
	);
}

/** Square — force stop. */
function stopGlyph(colour) {
	return `<rect x="50" y="52" width="44" height="44" rx="4" fill="${colour}"/>`;
}

/** Circular arrow — reboot. */
function rebootGlyph(colour) {
	return (
		`<path d="M48 72 A24 24 0 1 0 60 54" fill="none" stroke="${colour}" stroke-width="6" stroke-linecap="round"/>` +
		`<polygon points="56,46 66,56 52,58" fill="${colour}"/>`
	);
}

const GLYPHS = {
	start: startGlyph,
	shutdown: shutdownGlyph,
	stop: stopGlyph,
	reboot: rebootGlyph
};

/**
 * Working-state overlay: a rotating arc around the centre. `frame` is an
 * integer that cycles through 0..(steps-1) on each poll tick.
 */
function workingOverlay(frame, steps = 8) {
	const r = 54;
	const angle = (360 / steps) * (frame % steps);
	const sweep = 90;
	const startRad = ((angle - 90) * Math.PI) / 180;
	const endRad = ((angle + sweep - 90) * Math.PI) / 180;
	const x1 = CENTRE + r * Math.cos(startRad);
	const y1 = CENTRE + r * Math.sin(startRad);
	const x2 = CENTRE + r * Math.cos(endRad);
	const y2 = CENTRE + r * Math.sin(endRad);
	return `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${COLOUR_WORKING}" stroke-width="6" stroke-linecap="round" fill="none"/>`;
}

/**
 * Build an action-button icon.
 *
 * @param opts.kind one of 'start', 'shutdown', 'stop', 'reboot'
 * @param opts.state one of 'ready', 'disabled', 'working', 'error'
 * @param opts.label resource label (e.g. VM name) — scrolls if long
 * @param opts.topText optional top label (e.g. "START", "SHUTDOWN")
 * @param opts.frame animation frame index (drives both the working spinner
 *                   and the bottom-label marquee)
 */
export function buildActionIcon({ kind, state = 'ready', label = '', topText = '', frame = 0 }) {
	const colour = glyphColour(kind, state);
	const glyphFn = GLYPHS[kind];
	const glyph = glyphFn ? glyphFn(colour) : '';

	const overlay = state === 'working' ? workingOverlay(frame) : '';
	const errorTint = state === 'error'
		? `<rect width="${CANVAS}" height="${CANVAS}" fill="${COLOUR_OFFLINE}" opacity="0.2"/>`
		: '';

	return wrap(
		(topText ? topLabel(topText) : '') +
		glyph +
		overlay +
		errorTint +
		(label ? bottomLabel(label, { frame }) : '')
	);
}
