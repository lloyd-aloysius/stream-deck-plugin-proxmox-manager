/**
 * Shared SVG primitives used by all icon builders.
 *
 * All icons render into a 144×144 viewBox. `action.setImage()` accepts an
 * SVG string wrapped in a data URI, so we build strings directly — no
 * canvas or PNG conversion required.
 */

import {
	COLOUR_BG,
	COLOUR_TEXT,
	COLOUR_TRACK
} from '../utils/constants.js';

export const CANVAS = 144;
export const CENTRE = 72;

/**
 * Wrap an SVG body in the standard viewBox with a background rect,
 * and return it as a data URI ready for `action.setImage()`.
 */
export function wrap(bodySvg, { background = COLOUR_BG } = {}) {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}">` +
			`<rect width="${CANVAS}" height="${CANVAS}" fill="${background}"/>` +
			bodySvg +
		`</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/**
 * Build a polar-style arc path for a circular gauge.
 * @param cx centre x
 * @param cy centre y
 * @param r  radius
 * @param startAngleDeg start angle (0° = 3 o'clock, sweeps clockwise)
 * @param endAngleDeg   end angle
 */
export function arcPath(cx, cy, r, startAngleDeg, endAngleDeg) {
	const start = polar(cx, cy, r, endAngleDeg);
	const end = polar(cx, cy, r, startAngleDeg);
	let delta = endAngleDeg - startAngleDeg;
	if (delta < 0) delta += 360;
	const largeArc = delta > 180 ? 1 : 0;
	return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function polar(cx, cy, r, angleDeg) {
	const rad = ((angleDeg - 90) * Math.PI) / 180;
	return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * Circular gauge with a 270° sweep: track from 225° → 135° through the top,
 * and a fill covering `pct` (0–100) of that arc.
 * Returns an SVG fragment.
 */
export function gaugeArc({
	cx = CENTRE,
	cy = CENTRE,
	r = 56,
	stroke = 12,
	pct = 0,
	fillColour
}) {
	// Gauge sweeps clockwise from 225° (bottom-left) through the top to 135°
	// (bottom-right) — i.e. 270° of arc, with the bottom 90° opening centred
	// on the bottom of the tile where the label sits.
	const startAngle = 225;
	const endAngle = 225 + 270; // = 135° in the next rotation
	const clamped = Math.max(0, Math.min(100, pct));
	const fillEnd = startAngle + (270 * clamped) / 100;

	const trackPath = arcPath(cx, cy, r, startAngle, endAngle);
	const fillPath = clamped > 0 ? arcPath(cx, cy, r, startAngle, fillEnd) : '';

	return (
		`<path d="${trackPath}" stroke="${COLOUR_TRACK}" stroke-width="${stroke}" stroke-linecap="round" fill="none"/>` +
		(fillPath
			? `<path d="${fillPath}" stroke="${fillColour}" stroke-width="${stroke}" stroke-linecap="round" fill="none"/>`
			: '')
	);
}

/**
 * Centred text helper. Supply `y` in viewBox units; default values render a
 * large value above a smaller label (see `labelledValue` for the combined form).
 */
export function centredText({
	text,
	x = CENTRE,
	y = CENTRE,
	fontSize = 32,
	fill = COLOUR_TEXT,
	weight = 700
}) {
	const safe = escapeXml(text);
	return `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${fill}" text-anchor="middle" dominant-baseline="middle">${safe}</text>`;
}

/** Large value centred, label just below it. */
export function labelledValue({ value, label, valueSize = 38, labelSize = 18, valueColour = COLOUR_TEXT, labelColour = COLOUR_TEXT, frame }) {
	return (
		centredText({ text: value, y: 72, fontSize: valueSize, fill: valueColour, weight: 700 }) +
		marqueeBand({ text: label, y: 108, fontSize: labelSize, fill: labelColour, weight: 600, frame })
	);
}

/** Label at the very bottom of the tile (outside the gauge area). */
export function bottomLabel(text, { colour = COLOUR_TEXT, fontSize = 18, frame } = {}) {
	return marqueeBand({ text, y: 128, fontSize, fill: colour, weight: 600, frame });
}

/** Label at the top of the tile. */
export function topLabel(text, { colour = COLOUR_TEXT, fontSize = 16, frame } = {}) {
	return marqueeBand({ text, y: 26, fontSize, fill: colour, weight: 600, frame });
}

// ---- marquee ---------------------------------------------------------------

/**
 * Approximate character width for the sans-serif we use. This is a rough
 * average — perfect measurement requires a real DOM — but it's good enough
 * to decide between "fits centred" and "needs to scroll".
 */
const AVG_CHAR_WIDTH_RATIO = 0.58;
const MARQUEE_INSET_X = 6;          // leave a small margin on each side
const MARQUEE_PIXELS_PER_FRAME = 2; // scroll speed
const MARQUEE_GAP = '   •   ';      // separator when looping

function measureText(text, fontSize) {
	return String(text ?? '').length * fontSize * AVG_CHAR_WIDTH_RATIO;
}

/**
 * Render text inside a horizontal band. If the text fits the band, it is
 * drawn centred and static. If it overflows, it scrolls left at a steady
 * rate driven by the animation frame counter, wrapping around with a
 * gap separator so it reads like a news ticker.
 *
 * The text is always clipped to the band so nothing bleeds into the gauge
 * or the neighbouring tile edges.
 *
 * @param opts.text     The full text to display.
 * @param opts.y        Vertical centre of the band, in viewBox units.
 * @param opts.fontSize Font size in viewBox units.
 * @param opts.frame    Animation frame counter (undefined → static render).
 * @param opts.width    Band width; defaults to nearly the full canvas.
 */
export function marqueeBand({
	text,
	y,
	fontSize,
	fill = COLOUR_TEXT,
	weight = 600,
	frame,
	width = CANVAS - MARQUEE_INSET_X * 2
}) {
	const safeText = String(text ?? '');
	if (!safeText) return '';
	const textWidth = measureText(safeText, fontSize);
	const bandLeft = MARQUEE_INSET_X;
	const bandRight = bandLeft + width;
	const bandHeight = fontSize + 6;
	const bandTop = y - bandHeight / 2;
	const clipId = `mclip-${Math.abs(hash(`${safeText}-${y}-${fontSize}`))}`;

	// Fits — render centred, no scroll, no clip needed.
	if (textWidth <= width) {
		return `<text x="${CENTRE}" y="${y}" font-family="Helvetica, Arial, sans-serif" ` +
			`font-size="${fontSize}" font-weight="${weight}" fill="${fill}" ` +
			`text-anchor="middle" dominant-baseline="middle">${escapeXml(safeText)}</text>`;
	}

	// Overflows — scroll. We draw the text twice, separated by a gap, and
	// translate both together so that when the first copy has fully left
	// the band, the second copy is at the starting position.
	const gapWidth = measureText(MARQUEE_GAP, fontSize);
	const loopWidth = textWidth + gapWidth;
	const f = typeof frame === 'number' ? frame : 0;
	const offset = (f * MARQUEE_PIXELS_PER_FRAME) % loopWidth;
	const startX = bandLeft - offset;

	const rendered = escapeXml(safeText + MARQUEE_GAP + safeText + MARQUEE_GAP);
	return (
		`<defs><clipPath id="${clipId}">` +
			`<rect x="${bandLeft}" y="${bandTop}" width="${width}" height="${bandHeight}"/>` +
		`</clipPath></defs>` +
		`<g clip-path="url(#${clipId})">` +
			`<text x="${startX.toFixed(2)}" y="${y}" ` +
				`font-family="Helvetica, Arial, sans-serif" ` +
				`font-size="${fontSize}" font-weight="${weight}" fill="${fill}" ` +
				`dominant-baseline="middle">${rendered}</text>` +
		`</g>`
	);
}

/**
 * Convenience: returns true if the given text would overflow a band of
 * `width` pixels at `fontSize`. Action instances use this to decide whether
 * to spin up a marquee ticker at all.
 */
export function textOverflows(text, fontSize, width = CANVAS - MARQUEE_INSET_X * 2) {
	return measureText(text, fontSize) > width;
}

/** Tiny deterministic hash used to give each clipPath a unique id. */
function hash(s) {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = ((h << 5) - h + s.charCodeAt(i)) | 0;
	}
	return h;
}

/** Filled circle — handy for status dots. */
export function circle({ cx, cy, r, fill, stroke, strokeWidth }) {
	const s = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth ?? 2}"` : '';
	return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${s}/>`;
}

/** Rounded rectangle. */
export function rect({ x, y, width, height, rx = 0, fill, stroke, strokeWidth }) {
	const s = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth ?? 2}"` : '';
	return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${fill}"${s}/>`;
}

/** XML escape helper for user-provided strings. */
export function escapeXml(str) {
	return String(str ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}
