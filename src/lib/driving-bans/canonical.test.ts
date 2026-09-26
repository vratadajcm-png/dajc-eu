import {it} from 'vitest';
import assert from 'node:assert/strict';
import {registerDrivingBanTests} from '../../../tests/driving-bans-cases.mjs';
registerDrivingBanTests(it,assert);
