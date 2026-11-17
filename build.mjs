import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts', 'src/typert.ts'],
  outdir: 'lib',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
})

await build({
  entryPoints: ['src/client.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  external: ['react'],
  banner: { js: 'window.__ModuleLoader__.load({id:"dsh-model-key-pool",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' },
})
