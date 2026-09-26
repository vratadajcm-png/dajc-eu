import test from 'node:test';
import assert from 'node:assert/strict';
import {registerDrivingBanTests} from './driving-bans-cases.mjs';
import {registerProductionDrivingBanTests} from './driving-bans-production-cases.mjs';
registerDrivingBanTests(test,assert);
registerProductionDrivingBanTests(test,assert);
