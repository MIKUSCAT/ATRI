#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED_PROMPTS_DIR = ROOT / 'shared' / 'prompts'
WORKER_CONFIG = ROOT / 'worker' / 'src' / 'config'

PROMPT_FILES = {
    'core_self': {'system': 'core_self.md'},
    'agent': {'system': 'agent.md'},
    'proactive': {'system': 'proactive.md'},
    'diary': {'system': 'diary.md', 'userTemplate': 'diary.user_template.md'},
    'nightly_memory': {'system': 'nightly_memory.md'},
    'nightly_state': {'system': 'nightly_state.md'},
    'self_model_update': {'system': 'self_model_update.md'},
}

def build_prompts():
    out = {}
    for group, fields in PROMPT_FILES.items():
        out[group] = {}
        for field, filename in fields.items():
            path = SHARED_PROMPTS_DIR / filename
            if not path.exists():
                raise FileNotFoundError(f'missing: {path}')
            out[group][field] = path.read_text(encoding='utf-8')
    return out

def write_worker_config(prompts):
    target = WORKER_CONFIG / 'prompts.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(prompts, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'generated {target.relative_to(ROOT)} from {SHARED_PROMPTS_DIR.relative_to(ROOT)}')

def main():
    write_worker_config(build_prompts())

if __name__ == '__main__':
    main()
