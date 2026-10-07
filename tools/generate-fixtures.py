"""Regenerate synthetic reference fixtures; no private data or production model imports."""
import json
from pathlib import Path
from reference_models import replay

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures'
OUT.mkdir(parents=True, exist_ok=True)

def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

state = 20261007
rows = []
for i in range(60):
    state = (1664525 * state + 1013904223) % 2**32
    threshold = 0.7 if i < 30 else 0.3
    rows.append({'id': f'synthetic-fixture-record-{i + 1}',
                 'outcome': 'win' if state / 2**32 < threshold else 'loss',
                 'role': None, 'mode': 'quick-play' if i % 2 else 'competitive',
                 'entryKind': 'synthetic', 'fieldOrigin': 'synthetic'})
save('synthetic-history.json', {'sourceKind': 'synthetic', 'seed': 20261007,
     'records': rows, 'chronology': {'recordIdsOldestToNewest': [r['id'] for r in rows]}})
save('model-reference.json', {'sourceKind': 'synthetic', 'sample': replay([int(r['outcome'] == 'win') for r in rows])})

histories = {
    'tank': [1,1,0,1,0,0,1,1,1,0,1,0,0,1,0,1,1,0,1,0],
    'damage': [0,1,0,0,1,0,1,0,1,1,0,1,0,1,0,0,1,1],
    'support': [1,0,1,1,0,1,0,1,0,1,1,0,0,1,0,1,1,0,1,1,0,1,0,1],
}
records = []
for i in range(max(map(len, histories.values()))):
    for role, labels in histories.items():
        if i < len(labels):
            records.append({'ordinal': len(records) + 1, 'role': role,
                            'mode': ['quick-play', 'competitive', 'arcade', None][len(records) % 4],
                            'outcome': 'win' if labels[i] else 'loss'})
for outcome in ['win', 'loss']:
    records.append({'ordinal': len(records) + 1, 'role': None, 'mode': None, 'outcome': outcome})

def views(records):
    result = {}
    for scope in ['all', *histories]:
        labels = [int(r['outcome'] == 'win') for r in records if scope == 'all' or r['role'] == scope]
        result[scope] = {'n': len(labels), 'base': replay(labels)['nextPrediction']}
    return result

branches = {}
for scope in ['all', *histories]:
    branches[scope] = {}
    for outcome in ['win', 'loss']:
        branches[scope][outcome] = views(records + [{'role': None if scope == 'all' else scope, 'outcome': outcome}])
save('scope-reference.json', {'sourceKind': 'synthetic', 'syntheticRecords': records,
     'preview': {'views': views(records), 'branches': branches}})
print('Generated 60 synthetic matches, independent model references and all four scope branches.')
