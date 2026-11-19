import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Cache } from '../src/core/http';

/** JSON-file cache so benchmark runs are reproducible and do not re-hit public APIs. */
export class FileCache implements Cache {
  private m: Record<string, unknown> = {};
  private dirty = false;
  private path: string;
  constructor(path: string) {
    this.path = path;
    if (existsSync(path)) this.m = JSON.parse(readFileSync(path, 'utf8'));
    setInterval(() => this.flush(), 5000).unref();
  }
  async get(k: string) {
    return k in this.m ? this.m[k] : undefined;
  }
  async set(k: string, v: unknown) {
    this.m[k] = v;
    this.dirty = true;
  }
  flush() {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.m));
    this.dirty = false;
  }
}
