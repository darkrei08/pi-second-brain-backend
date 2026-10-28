#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { segmentDocument } from './index.js';

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  process.stdout.write(`${JSON.stringify(segmentDocument(input.document, input.policy))}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
