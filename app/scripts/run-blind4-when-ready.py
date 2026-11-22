"""One local background continuation: wait for the free OpenAlex reset, then run the frozen audit once.

Run inside the detached freeze worktree after selection. Does not schedule a system task or buy quota.
Progress/headers go to stdout; the machine must stay awake. Existing results/lock are never overwritten.
"""
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.request

APP = Path(__file__).resolve().parents[1]
DATA = APP.parent / 'data' / 'blind4'


def log(message):
    print(datetime.datetime.now(datetime.timezone.utc).isoformat(), message, flush=True)


manifest = json.loads((DATA / 'manifest.json').read_text(encoding='utf-8'))
if not manifest.get('selectionComplete'):
    raise RuntimeError('Selection incomplete; do not audit a partial replacement set')
if (DATA / 'results.json').exists() or (DATA / 'run.lock').exists():
    raise RuntimeError('An audit already started; inspect it instead of rerunning')

deadline = time.time() + 20 * 3600
ready = False
while time.time() < deadline:
    url = 'https://api.openalex.org/works?filter=doi:10.1038/nature14539&per-page=1'
    req = urllib.request.Request(url, headers={'User-Agent': 'veracite-frozen-audit/1.0'})
    try:
        response = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    except OSError as error:
        log(f'OpenAlex unavailable: {error}; retry in 10 minutes')
        time.sleep(600)
        continue
    with response:
        headers = {k.lower(): v for k, v in response.headers.items() if 'ratelimit' in k.lower()}
        status = response.code
    log(json.dumps({'openalexStatus': status, 'headers': headers}))
    with (DATA / 'allowance.jsonl').open('a', encoding='utf-8') as output:
        output.write(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'status': status, 'headers': headers}) + '\n')
    if status == 200 and float(headers.get('x-ratelimit-remaining-usd', '0')) > 0:
        ready = True
        break
    delay = min(12 * 3600, max(60, int(headers.get('x-ratelimit-reset', '600')) + 10)) if status == 429 else 600
    log(f'Waiting {delay} seconds for free allowance')
    # Short sleeps allow the process to be interrupted without altering any other project.
    wake = time.time() + delay
    while time.time() < min(wake, deadline):
        time.sleep(min(60, max(0, min(wake, deadline) - time.time())))

if not ready:
    raise RuntimeError('No free allowance within 20 hours; no audit was started')
env = {**os.environ, 'BLIND_SET': '4'}
log('Starting one frozen blind4 run, empty cache, no API keys')
result = subprocess.run([shutil.which('node'), str(APP / 'node_modules/tsx/dist/cli.mjs'), 'scripts/blind-test.ts'], cwd=APP, env=env)
log(f'Audit exited {result.returncode}; manual flag, miss and field reviews still required')
raise SystemExit(result.returncode)
