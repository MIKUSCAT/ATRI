import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import type { Store } from '@atri/db';
import type { Sticker } from '@atri/core';
import { sniffMediaMime, isVisionMime } from '@atri/ilink';

export class Stickers {
  constructor(
    readonly root: string,
    readonly dataDir: string,
    private readonly store: Store,
  ) {}
  list(includeDisabled = false): (Sticker & { disabled: boolean })[] {
    const builtins = JSON.parse(
      readFileSync(join(this.root, 'assets', 'stickers', 'catalog.json'), 'utf8'),
    ) as Sticker[];
    const disabled = new Set(this.store.getSetting<string[]>('stickers:disabled', []));
    return [...builtins, ...this.store.getSetting<Sticker[]>('stickers:custom', [])]
      .map((s) => ({ ...s, disabled: disabled.has(s.slug) }))
      .filter((s) => includeDisabled || !s.disabled);
  }
  bytes(slug: string): Buffer {
    const item = this.list(true).find((s) => s.slug === slug);
    if (!item) throw new Error('表情不存在');
    const base = item.file.startsWith('custom/')
      ? this.dataDir
      : join(this.root, 'assets', 'stickers');
    const path = resolve(base, item.file);
    if (!path.startsWith(resolve(base) + sep)) throw new Error('表情路径无效');
    const bytes = readFileSync(path);
    if (bytes.length > 5 * 1024 * 1024) throw new Error('表情文件过大');
    return bytes;
  }
  add(input: { slug: string; description: string; tags: string[]; base64: string }) {
    if (
      !/^[a-z0-9_-]{1,40}$/.test(input.slug) ||
      this.list(true).some((s) => s.slug === input.slug)
    )
      throw new Error('表情 slug 无效或已经存在');
    if (this.list().length >= 32) throw new Error('最多启用 32 个表情，请先停用不常用的素材');
    if (!input.description.trim() || input.description.length > 200)
      throw new Error('请填写不超过 200 字的表情含义');
    const bytes = Buffer.from(input.base64, 'base64'),
      mime = sniffMediaMime(bytes);
    if (!bytes.length || bytes.length > 3 * 1024 * 1024 || !isVisionMime(mime))
      throw new Error('支持 3 MB 以内的 PNG、JPEG、GIF、WebP');
    const file = `custom/${randomUUID()}.${mime!.split('/')[1]}`;
    mkdirSync(join(this.dataDir, 'custom'), { recursive: true });
    writeFileSync(join(this.dataDir, file), bytes);
    const list = this.store.getSetting<Sticker[]>('stickers:custom', []);
    list.push({
      slug: input.slug,
      description: input.description,
      tags: input.tags.slice(0, 8).map((tag) => tag.slice(0, 40)),
      file,
    });
    this.store.setSetting('stickers:custom', list);
  }
  disable(slug: string) {
    this.store.setSetting('stickers:disabled', [
      ...new Set([...this.store.getSetting<string[]>('stickers:disabled', []), slug]),
    ]);
  }
  enable(slug: string) {
    const item = this.list(true).find((s) => s.slug === slug);
    if (!item) throw new Error('表情不存在');
    if (!item.disabled) return;
    if (this.list().length >= 32) throw new Error('最多启用 32 个表情，请先停用不常用的素材');
    this.store.setSetting(
      'stickers:disabled',
      this.store.getSetting<string[]>('stickers:disabled', []).filter((s) => s !== slug),
    );
  }
}
