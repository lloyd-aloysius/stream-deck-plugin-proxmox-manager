// Generates placeholder PNG files for all manifest-referenced icons.
// These are static icons shown in the Stream Deck action gallery —
// runtime icons are generated dynamically as SVG (see src/icons/).

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

/** Build a minimal uncompressed PNG with a solid colour fill. */
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
	ihdr[8] = 8;  // bit depth
	ihdr[9] = 2;  // colour type: RGB
	ihdr[10] = 0; // compression
	ihdr[11] = 0; // filter
	ihdr[12] = 0; // interlace

	const rowSize = width * 3;
	const raw = Buffer.alloc((rowSize + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (rowSize + 1)] = 0; // filter: none
		for (let x = 0; x < width; x++) {
			const o = y * (rowSize + 1) + 1 + x * 3;
			raw[o] = r;
			raw[o + 1] = g;
			raw[o + 2] = b;
		}
	}
	const idat = zlib.deflateSync(raw);

	return Buffer.concat([
		sig,
		chunk('IHDR', ihdr),
		chunk('IDAT', idat),
		chunk('IEND', Buffer.alloc(0))
	]);
}

const BG = [26, 26, 46];        // #1a1a2e
const GREEN = [76, 175, 80];    // #4CAF50
const BLUE = [33, 150, 243];    // #2196F3
const RED = [244, 67, 54];      // #F44336
const AMBER = [255, 152, 0];    // #FF9800

// actionId → colour used for the placeholder tile
const actionColours = {
	'server-overview': GREEN,
	'server-stats': BLUE,
	'node-overview': GREEN,
	'node-stats': BLUE,
	'vm-overview': GREEN,
	'vm-stats': BLUE,
	'vm-start': GREEN,
	'vm-shutdown': AMBER,
	'vm-force-stop': RED,
	'vm-reboot': BLUE,
	'ct-overview': GREEN,
	'ct-stats': BLUE,
	'ct-start': GREEN,
	'ct-shutdown': AMBER,
	'ct-force-stop': RED,
	'ct-reboot': BLUE
};

const write = (relPath, buf) => {
	const full = resolve(root, relPath);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, buf);
	console.log('  wrote', relPath);
};

// Plugin-level icons (category + plugin). @1x and @2x required.
console.log('[icons] plugin gallery icons');
write('imgs/plugin/category-icon.png', solidPng(28, 28, BG));
write('imgs/plugin/category-icon@2x.png', solidPng(56, 56, BG));
write('imgs/plugin/plugin-icon.png', solidPng(72, 72, BG));
write('imgs/plugin/plugin-icon@2x.png', solidPng(144, 144, BG));

// Per-action icons: gallery "icon" (72x72) + state "key" image (144x144).
console.log('[icons] action gallery + state icons');
for (const [actionId, colour] of Object.entries(actionColours)) {
	write(`imgs/actions/${actionId}/icon.png`, solidPng(72, 72, colour));
	write(`imgs/actions/${actionId}/icon@2x.png`, solidPng(144, 144, colour));
	write(`imgs/actions/${actionId}/key.png`, solidPng(144, 144, BG));
	write(`imgs/actions/${actionId}/key@2x.png`, solidPng(288, 288, BG));
}

console.log('[icons] done');
