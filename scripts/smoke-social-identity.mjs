import { readBufferConfig, checkBufferChannel } from './lib/buffer-publishing.mjs';
import { readXCredentials, checkXAccount } from './lib/x-publishing.mjs';

let missing = 0;
for (const channel of ['x', 'linkedin']) {
  try {
    const config = readBufferConfig(channel);
    await checkBufferChannel(config);
    console.log('PASS Buffer ' + channel + ': verified DAJC company channel (no posting)');
  } catch (error) {
    console.log('NOT READY Buffer ' + channel + ': ' + error.message); missing++;
  }
}
try {
  const credentials = readXCredentials();
  await checkXAccount(credentials);
  console.log('PASS X direct API: @DAJCeu identity confirmed (no posting)');
} catch (error) {
  console.log('NOT READY X direct API: ' + error.message);
}
console.log('Read-only check complete. No social post was created.');
if (missing) process.exitCode = 1;