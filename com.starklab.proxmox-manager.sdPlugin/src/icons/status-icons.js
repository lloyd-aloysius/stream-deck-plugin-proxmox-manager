/**
 * Icon builders for Overview buttons (server / node / VM / CT).
 *
 * Each icon is a central silhouette of the resource with a colour-coded
 * status ring and a short label. Unknown / offline / reconnecting states
 * share the same builder but swap colours and labels.
 */

import {
	COLOUR_ONLINE,
	COLOUR_DEGRADED,
	COLOUR_OFFLINE,
	COLOUR_DISABLED,
	COLOUR_RECONNECTING,
	COLOUR_TEXT
} from '../utils/constants.js';
import {
	CANVAS,
	CENTRE,
	bottomLabel,
	circle,
	topLabel,
	wrap
} from './svg-generator.js';

/**
 * Map an abstract status → colour.
 * Accepted states: online, running, degraded, paused, offline, stopped,
 * reconnecting, auth, unknown.
 */
export function statusColour(state) {
	switch (state) {
		case 'online':
		case 'running':
			return COLOUR_ONLINE;
		case 'degraded':
		case 'paused':
			return COLOUR_DEGRADED;
		case 'offline':
		case 'stopped':
			return COLOUR_OFFLINE;
		case 'reconnecting':
			return COLOUR_RECONNECTING;
		case 'auth':
			return COLOUR_OFFLINE;
		default:
			return COLOUR_DISABLED;
	}
}

export function statusLabel(state) {
	switch (state) {
		case 'online':       return 'ONLINE';
		case 'running':      return 'RUNNING';
		case 'degraded':     return 'DEGRADED';
		case 'paused':       return 'PAUSED';
		case 'offline':      return 'OFFLINE';
		case 'stopped':      return 'STOPPED';
		case 'reconnecting': return 'RECONNECT';
		case 'auth':         return 'AUTH ERR';
		default:             return '—';
	}
}

/**
 * Base status icon: central silhouette, outer status ring, name label
 * under the glyph.
 *
 * @param opts.glyph   SVG fragment drawn at the centre (already positioned).
 * @param opts.state   status key (see statusColour)
 * @param opts.label   text shown at the bottom of the tile (scrolls if long)
 * @param opts.topText optional top label (e.g. resource type)
 * @param opts.frame   marquee animation frame counter (optional)
 */
export function statusIcon({ glyph, state, label = '', topText = '', frame }) {
	const colour = statusColour(state);
	const ring = `<circle cx="${CENTRE}" cy="68" r="34" fill="none" stroke="${colour}" stroke-width="5"/>`;
	const dot = circle({ cx: 108, cy: 36, r: 10, fill: colour, stroke: '#000', strokeWidth: 2 });
	return wrap(
		(topText ? topLabel(topText) : '') +
		ring +
		glyph +
		dot +
		(label ? bottomLabel(label, { frame }) : '')
	);
}

// ---- per-resource-type glyphs ---------------------------------------------

/** Server silhouette (stacked bars). */
function serverGlyph() {
	return (
		`<rect x="52" y="50" width="40" height="10" rx="2" fill="${COLOUR_TEXT}"/>` +
		`<rect x="52" y="64" width="40" height="10" rx="2" fill="${COLOUR_TEXT}"/>` +
		`<rect x="52" y="78" width="40" height="10" rx="2" fill="${COLOUR_TEXT}"/>` +
		`<circle cx="60" cy="55" r="1.6" fill="#4CAF50"/>` +
		`<circle cx="60" cy="69" r="1.6" fill="#4CAF50"/>` +
		`<circle cx="60" cy="83" r="1.6" fill="#4CAF50"/>`
	);
}

/** Single node: tower / blade shape. */
function nodeGlyph() {
	return (
		`<rect x="56" y="46" width="32" height="48" rx="3" fill="${COLOUR_TEXT}"/>` +
		`<rect x="60" y="52" width="24" height="4" fill="#1a1a2e"/>` +
		`<rect x="60" y="60" width="24" height="4" fill="#1a1a2e"/>` +
		`<rect x="60" y="68" width="24" height="4" fill="#1a1a2e"/>` +
		`<circle cx="72" cy="84" r="2.5" fill="#4CAF50"/>`
	);
}

/** VM glyph: rounded monitor screen. */
function vmGlyph() {
	return (
		`<rect x="48" y="48" width="48" height="34" rx="4" fill="${COLOUR_TEXT}"/>` +
		`<rect x="52" y="52" width="40" height="26" rx="2" fill="#1a1a2e"/>` +
		`<text x="72" y="70" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="${COLOUR_TEXT}">VM</text>` +
		`<rect x="62" y="86" width="20" height="4" rx="1" fill="${COLOUR_TEXT}"/>`
	);
}

/** CT glyph: cube/container. */
function ctGlyph() {
	return (
		`<path d="M72 42 L100 54 L100 82 L72 94 L44 82 L44 54 Z" fill="${COLOUR_TEXT}"/>` +
		`<path d="M72 42 L100 54 L72 66 L44 54 Z" fill="#1a1a2e" opacity="0.25"/>` +
		`<path d="M72 66 L72 94" stroke="#1a1a2e" stroke-width="1.5" opacity="0.5"/>` +
		`<text x="72" y="75" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="11" font-weight="700" fill="#1a1a2e">CT</text>`
	);
}

// ---- public builders ------------------------------------------------------

export function buildServerOverviewIcon({ state, name, frame }) {
	return statusIcon({ glyph: serverGlyph(), state, label: name, topText: 'SERVER', frame });
}

export function buildNodeOverviewIcon({ state, name, frame }) {
	return statusIcon({ glyph: nodeGlyph(), state, label: name, topText: 'NODE', frame });
}

export function buildVmOverviewIcon({ state, name, vmid, frame }) {
	return statusIcon({ glyph: vmGlyph(), state, label: name || `VM ${vmid}`, topText: vmid != null ? `VM ${vmid}` : 'VM', frame });
}

export function buildCtOverviewIcon({ state, name, vmid, frame }) {
	return statusIcon({ glyph: ctGlyph(), state, label: name || `CT ${vmid}`, topText: vmid != null ? `CT ${vmid}` : 'CT', frame });
}

/** Placeholder shown before any config is set. */
export function buildUnconfiguredIcon(kind) {
	return wrap(
		topLabel(kind.toUpperCase()) +
		`<circle cx="${CENTRE}" cy="${CENTRE}" r="28" fill="none" stroke="${COLOUR_DISABLED}" stroke-width="4" stroke-dasharray="4 4"/>` +
		`<text x="${CENTRE}" y="78" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="700" fill="${COLOUR_DISABLED}">?</text>` +
		bottomLabel('Not set', { colour: COLOUR_DISABLED })
	);
}

/** Icon for an authentication error state. */
export function buildAuthErrorIcon(kind) {
	return wrap(
		topLabel(kind.toUpperCase()) +
		`<circle cx="${CENTRE}" cy="${CENTRE}" r="28" fill="none" stroke="${COLOUR_OFFLINE}" stroke-width="5"/>` +
		`<text x="${CENTRE}" y="80" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="36" font-weight="700" fill="${COLOUR_OFFLINE}">!</text>` +
		bottomLabel('Auth error', { colour: COLOUR_OFFLINE })
	);
}
