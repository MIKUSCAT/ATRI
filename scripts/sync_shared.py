#!/usr/bin/env python3
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / 'shared'
PROMPTS_SRC = SHARED / 'prompts.json'
ANDROID_ASSETS = ROOT / 'ATRI' / 'app' / 'src' / 'main' / 'assets'
WORKER_CONFIG = ROOT / 'worker' / 'src' / 'config'

TARGETS = [
    (PROMPTS_SRC, ANDROID_ASSETS / 'prompts.json'),
    (PROMPTS_SRC, WORKER_CONFIG / 'prompts.json'),
]

def main():
    if not PROMPTS_SRC.exists():
        raise SystemExit(f'missing shared prompts file: {PROMPTS_SRC}')
    for src, dest in TARGETS:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        print(f'copied {src.relative_to(ROOT)} -> {dest.relative_to(ROOT)}')

if __name__ == '__main__':
    main()
