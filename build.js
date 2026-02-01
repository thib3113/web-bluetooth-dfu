import * as esbuild from 'esbuild';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function build() {
    console.log('🚀 Starting Universal Build...');

    await fs.rm('dist', { recursive: true, force: true });
    await fs.mkdir('dist', { recursive: true });

    // 1. Browser Bundle (IIFE) - Everything included
    // Target: <script src="secure-dfu.js"></script>
    console.log('📦 Building Browser Bundle (IIFE)...');
    await esbuild.build({
        entryPoints: ['src/browser.ts'],
        bundle: true,
        outfile: 'dist/secure-dfu.js',
        minify: true,
        sourcemap: true,
        target: ['es2017'],
        format: 'iife',
        platform: 'browser',
    });

    // 2. ESM Bundle (Modules) - Dependencies external
    // Target: import { SecureDfu } from 'web-bluetooth-dfu';
    console.log('📦 Building ESM Bundle...');
    await esbuild.build({
        entryPoints: ['src/index.ts'],
        bundle: true,
        outfile: 'dist/secure-dfu.mjs',
        minify: true,
        sourcemap: true,
        target: ['esnext'],
        format: 'esm',
        packages: 'external', // Auto-exclude dependencies (jszip, crc-32)
    });

    // 3. CJS Bundle (CommonJS) - Dependencies external
    // Target: const { SecureDfu } = require('web-bluetooth-dfu');
    console.log('📦 Building CJS Bundle...');
    await esbuild.build({
        entryPoints: ['src/index.ts'],
        bundle: true,
        outfile: 'dist/secure-dfu.cjs',
        minify: true,
        sourcemap: true,
        target: ['es2017'],
        format: 'cjs',
        packages: 'external', // Auto-exclude dependencies
    });

    // 4. Type Definitions
    console.log('📝 Generating Type Definitions...');
    try {
        await execAsync('npx tsc');
    } catch (err) {
        console.error('❌ Type generation failed:', err.stdout || err.message);
        // We don't necessarily want to fail the whole build if just types have issues, 
        // but for a library it's usually better to be strict.
        throw err;
    }

    console.log('✅ Build complete! Output in /dist');
}

build().catch(err => {
    console.error(err);
    process.exit(1);
});