import test from 'node:test';
import assert from 'node:assert/strict';
import {registerDrivingBanTests} from './driving-bans-cases.mjs';
registerDrivingBanTests(test,assert);
