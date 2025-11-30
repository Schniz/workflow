import { addition } from './addition.mjs';
import { benchmark } from './benchmark.mjs';
import { errors } from './errors.mjs';
import { hooks } from './hooks.mjs';
import { idempotency } from './idempotency.mjs';
import { nullByte } from './null-byte.mjs';

export function createTestSuite(pkgName: string) {
  addition(pkgName);
  benchmark(pkgName);
  errors(pkgName);
  hooks(pkgName);
  idempotency(pkgName);
  nullByte(pkgName);
}
