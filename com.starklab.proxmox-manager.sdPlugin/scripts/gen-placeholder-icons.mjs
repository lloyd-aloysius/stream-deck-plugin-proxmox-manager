// Generates static icon files for all manifest-referenced actions.
// Gallery icons (icon.svg) show real glyphs so the action picker is meaningful.
// Runtime key images (key.png) are dark placeholders — the plugin overwrites
// them dynamically via setImage() as soon as the button appears.

import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const write = (relPath, content) => {
	const full = resolve(root, relPath);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, content);
	console.log('  wrote', relPath);
};

const remove = (relPath) => {
	const full = resolve(root, relPath);
	if (existsSync(full)) {
		unlinkSync(full);
		console.log('  removed', relPath);
	}
};

// ---- Minimal solid-colour PNG (for key.png runtime fallback) ---------------

function solidPng(width, height, [r, g, b]) {
	const crc32 = (buf) => {
		let c;
		const table = [];
		for (let n = 0; n < 256; n++) {
			c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[n] = c >>> 0;
		}
		let crc = 0xffffffff;
		for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
		return (crc ^ 0xffffffff) >>> 0;
	};
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length, 0);
		const typeBuf = Buffer.from(type, 'ascii');
		const crcBuf = Buffer.alloc(4);
		crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
		return Buffer.concat([len, typeBuf, data, crcBuf]);
	};
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; ihdr[9] = 2;
	const rowSize = width * 3;
	const raw = Buffer.alloc((rowSize + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (rowSize + 1)] = 0;
		for (let x = 0; x < width; x++) {
			const o = y * (rowSize + 1) + 1 + x * 3;
			raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
		}
	}
	return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- SVG gallery icon builder ----------------------------------------------

const BG_DARK   = '#1a1a2e';
const WHITE     = '#ffffff';
const GREEN     = '#4CAF50';
const BLUE      = '#2196F3';
const RED       = '#F44336';
const AMBER     = '#FF9800';
const GREY      = '#616161';

/** Wrap SVG body in a 72×72 viewBox with a background rect. */
function svgIcon(bg, body) {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" fill="${bg}"/>${body}</svg>`;
}

// ---- Glyphs (all drawn in a 72×72 coordinate space) -----------------------

function startGlyph(colour) {
	// Play triangle — scaled down from 144px canvas (÷2)
	return `<polygon points="29,23 29,49 51,36" fill="${colour}"/>`;
}

function shutdownGlyph(colour) {
	return (
		`<circle cx="36" cy="37" r="12" fill="none" stroke="${colour}" stroke-width="3"/>` +
		`<path d="M36 27 L36 37" stroke="${colour}" stroke-width="3" stroke-linecap="round"/>` +
		`<rect x="32" y="22" width="8" height="3" fill="${BG_DARK}"/>`
	);
}

function stopGlyph(colour) {
	return `<rect x="25" y="26" width="22" height="22" rx="2" fill="${colour}"/>`;
}

function rebootGlyph(colour) {
	return (
		`<path d="M24 36 A12 12 0 1 0 30 27" fill="none" stroke="${colour}" stroke-width="3" stroke-linecap="round"/>` +
		`<polygon points="28,23 33,28 26,29" fill="${colour}"/>`
	);
}

function serverGlyph() {
	return (
		`<rect x="20" y="22" width="32" height="8" rx="1.5" fill="${WHITE}"/>` +
		`<rect x="20" y="32" width="32" height="8" rx="1.5" fill="${WHITE}"/>` +
		`<rect x="20" y="42" width="32" height="8" rx="1.5" fill="${WHITE}"/>` +
		`<circle cx="24" cy="26" r="1.2" fill="${GREEN}"/>` +
		`<circle cx="24" cy="36" r="1.2" fill="${GREEN}"/>` +
		`<circle cx="24" cy="46" r="1.2" fill="${GREEN}"/>`
	);
}

function nodeGlyph() {
	return (
		`<rect x="26" y="18" width="20" height="30" rx="2" fill="${WHITE}"/>` +
		`<rect x="29" y="22" width="14" height="2.5" fill="${BG_DARK}"/>` +
		`<rect x="29" y="27" width="14" height="2.5" fill="${BG_DARK}"/>` +
		`<rect x="29" y="32" width="14" height="2.5" fill="${BG_DARK}"/>` +
		`<circle cx="36" cy="52" r="2" fill="${GREEN}"/>`
	);
}

function vmGlyph() {
	return (
		`<rect x="18" y="20" width="36" height="24" rx="2.5" fill="${WHITE}"/>` +
		`<rect x="21" y="23" width="30" height="18" rx="1.5" fill="${BG_DARK}"/>` +
		`<text x="36" y="36" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="9" font-weight="700" fill="${WHITE}">VM</text>` +
		`<rect x="28" y="47" width="16" height="3" rx="1" fill="${WHITE}"/>`
	);
}

function ctGlyph() {
	return (
		`<path d="M36 16 L56 24 L56 44 L36 52 L16 44 L16 24 Z" fill="${WHITE}"/>` +
		`<path d="M36 16 L56 24 L36 32 L16 24 Z" fill="${BG_DARK}" opacity="0.25"/>` +
		`<path d="M36 32 L36 52" stroke="${BG_DARK}" stroke-width="1" opacity="0.5"/>` +
		`<text x="36" y="44" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="8" font-weight="700" fill="${BG_DARK}">CT</text>`
	);
}

function statsGlyph(colour) {
	// Simple gauge arc (180° semicircle) with a needle
	return (
		`<path d="M18 44 A18 18 0 0 1 54 44" fill="none" stroke="${GREY}" stroke-width="4" stroke-linecap="round"/>` +
		`<path d="M18 44 A18 18 0 0 1 44 28" fill="none" stroke="${colour}" stroke-width="4" stroke-linecap="round"/>` +
		`<text x="36" y="42" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="10" font-weight="700" fill="${WHITE}">%</text>`
	);
}

// ---- Icon definitions -------------------------------------------------------

const actions = [
	{ id: 'server-overview', bg: BG_DARK, accentBg: BG_DARK, glyph: () => serverGlyph(), label: 'SRV' },
	{ id: 'server-stats',    bg: BG_DARK, accentBg: BG_DARK, glyph: () => statsGlyph(BLUE), label: 'SRV' },
	{ id: 'node-overview',   bg: BG_DARK, accentBg: BG_DARK, glyph: () => nodeGlyph(), label: 'NODE' },
	{ id: 'node-stats',      bg: BG_DARK, accentBg: BG_DARK, glyph: () => statsGlyph(BLUE), label: 'NODE' },
	{ id: 'vm-overview',     bg: BG_DARK, accentBg: BG_DARK, glyph: () => vmGlyph(), label: 'VM' },
	{ id: 'vm-stats',        bg: BG_DARK, accentBg: BG_DARK, glyph: () => statsGlyph(BLUE), label: 'VM' },
	{ id: 'vm-start',        bg: BG_DARK, accentBg: BG_DARK, glyph: () => startGlyph(GREEN), label: 'START' },
	{ id: 'vm-shutdown',     bg: BG_DARK, accentBg: BG_DARK, glyph: () => shutdownGlyph(AMBER), label: 'SHTDN' },
	{ id: 'vm-force-stop',   bg: BG_DARK, accentBg: BG_DARK, glyph: () => stopGlyph(RED), label: 'STOP' },
	{ id: 'vm-reboot',       bg: BG_DARK, accentBg: BG_DARK, glyph: () => rebootGlyph(BLUE), label: 'REBOOT' },
	{ id: 'ct-overview',     bg: BG_DARK, accentBg: BG_DARK, glyph: () => ctGlyph(), label: 'CT' },
	{ id: 'ct-stats',        bg: BG_DARK, accentBg: BG_DARK, glyph: () => statsGlyph(BLUE), label: 'CT' },
	{ id: 'ct-start',        bg: BG_DARK, accentBg: BG_DARK, glyph: () => startGlyph(GREEN), label: 'START' },
	{ id: 'ct-shutdown',     bg: BG_DARK, accentBg: BG_DARK, glyph: () => shutdownGlyph(AMBER), label: 'SHTDN' },
	{ id: 'ct-force-stop',   bg: BG_DARK, accentBg: BG_DARK, glyph: () => stopGlyph(RED), label: 'STOP' },
	{ id: 'ct-reboot',       bg: BG_DARK, accentBg: BG_DARK, glyph: () => rebootGlyph(BLUE), label: 'REBOOT' },
];

const BG_RGB = [26, 26, 46]; // #1a1a2e

// Plugin-level icons (always dark background, no glyph needed here)
console.log('[icons] plugin gallery icons');
write('imgs/plugin/category-icon.png', solidPng(28, 28, BG_RGB));
write('imgs/plugin/category-icon@2x.png', solidPng(56, 56, BG_RGB));
write('imgs/plugin/plugin-icon.png', solidPng(72, 72, BG_RGB));
write('imgs/plugin/plugin-icon@2x.png', solidPng(144, 144, BG_RGB));

// Per-action icons
console.log('[icons] action gallery SVGs + key PNGs');
for (const { id, bg, glyph, label } of actions) {
	const body = glyph() +
		`<text x="36" y="68" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="8" font-weight="600" fill="#aaaaaa">${label}</text>`;
	const svg = svgIcon(bg, body);

	// Write SVG gallery icon (replaces solid-colour PNG)
	write(`imgs/actions/${id}/icon.svg`, svg);
	write(`imgs/actions/${id}/icon@2x.svg`, svg);

	// Remove old solid-colour PNGs so the SDK falls back to the SVGs
	remove(`imgs/actions/${id}/icon.png`);
	remove(`imgs/actions/${id}/icon@2x.png`);

	// key.png: dark placeholder — plugin overwrites via setImage() at runtime
	write(`imgs/actions/${id}/key.png`, solidPng(144, 144, BG_RGB));
	write(`imgs/actions/${id}/key@2x.png`, solidPng(288, 288, BG_RGB));
}

console.log('[icons] done');
