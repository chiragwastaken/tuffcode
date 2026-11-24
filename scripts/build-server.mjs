#!/usr/bin/env node
// Bundles the Node-side server into one ESM file for the Electron utility process
// and for packaging (spec section 12): packages/server/dist/server.js.
//
// Externals are deliberately narrow: node-pty ships prebuilds that must stay on
// disk, and every `node:` builtin (node:sqlite included) is provided by the
// runtime. Everything else, workspace packages included, is bundled.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

try {
  await build({
    absWorkingDir: root,
    entryPoints: ['packages/server/src/index.ts'],
    outfile: 'packages/server/dist/server.js',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    sourcemap: false,
    minify: false,
    // `node:` builtins are external automatically on platform node.
    external: ['node-pty'],
    // `ws` is CommonJS and requires Node builtins lazily at runtime. ESM output
    // has no `require`, so esbuild's shim would throw "Dynamic require of
    // events is not supported"; a real require from import.meta.url fixes it.
    // import.meta.url itself is preserved natively by ESM output.
    banner: {
      js: "import { createRequire as __tuffcodeCreateRequire } from 'node:module'; const require = __tuffcodeCreateRequire(import.meta.url);",
    },
    logLevel: 'warning',
  });
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`server build failed:\n${message}\n`);
  process.exit(1);
}
