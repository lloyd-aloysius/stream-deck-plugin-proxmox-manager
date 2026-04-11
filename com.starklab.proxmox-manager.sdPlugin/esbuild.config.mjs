import esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const config = {
	entryPoints: ['src/plugin.js'],
	bundle: true,
	outfile: 'bin/plugin.js',
	platform: 'node',
	target: 'node20',
	format: 'esm',
	external: [],
	banner: {
		js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
	},
	loader: {
		'.node': 'copy'
	},
	logLevel: 'info'
};

if (isWatch) {
	const ctx = await esbuild.context(config);
	await ctx.watch();
	console.log('[esbuild] watching…');
} else {
	await esbuild.build(config);
}
