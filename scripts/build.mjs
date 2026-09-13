import { build } from 'esbuild';
await build({
  entryPoints: {
    server: 'apps/api/src/index.ts',
    backup: 'scripts/backup.ts',
    restore: 'scripts/restore.ts',
  },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outdir: 'dist',
  external: ['fastify', 'qrcode'],
  sourcemap: true,
});
