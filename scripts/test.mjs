import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : e.name.endsWith('.test.ts')
        ? [join(dir, e.name)]
        : [],
  );
}
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...files('packages'), ...files('tests')],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
