#!/usr/bin/env node
import { loadAutomationData, saveAutomationData } from './lib/automation-data.mjs';

try {
  const [action, kind, extra] = process.argv.slice(2);
  if (!['load', 'save'].includes(action) || !['findings', 'x'].includes(kind) || extra) throw new Error('Usage: node scripts/automation-data.mjs load|save findings|x');
  if (action === 'load') loadAutomationData(kind);
  else saveAutomationData(kind);
} catch (error) {
  console.error(`::error::Automation data: ${error.message}`);
  process.exitCode = 1;
}
