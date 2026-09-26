import {it} from 'vitest';
import assert from 'node:assert/strict';
import {registerProductionDrivingBanTests} from '../../../tests/driving-bans-production-cases.mjs';
registerProductionDrivingBanTests(it,assert);
