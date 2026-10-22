import {it} from 'vitest';
import assert from 'node:assert/strict';
import {registerProductionDrivingBanTests} from '../../../tests/driving-bans-production-cases.mjs';
// Full-dataset ICS validation takes over five seconds on shared CI runners.
// Keep every assertion, with a bounded timeout for this production-data suite.
registerProductionDrivingBanTests(
  (name: string, run: () => void) => it(name, run, 15_000),
  assert,
);
