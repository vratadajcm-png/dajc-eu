import { validateBufferChannel } from './lib/buffer-publishing.mjs';
const key = process.env.BUFFER_API_KEY;
if (!key) { console.error('BUFFER_API_KEY not configured'); process.exit(1); }
const query = async text => {
  const res = await fetch('https://api.buffer.com', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ query: text }), signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('Buffer API HTTP ' + res.status);
  const body = await res.json();
  if (body.errors?.length) throw new Error('Buffer GraphQL refused read-only query');
  return body.data;
};
try {
  const account = await query('query { account { organizations { id } } }');
  const orgs = account?.account?.organizations || [];
  console.log('Buffer organization count: ' + orgs.length);
  let found = 0;
  for (const org of orgs.slice(0, 5)) {
    const result = await query('query { channels(input: { organizationId: ' + JSON.stringify(org.id) + ' }) { id name displayName service type externalLink isDisconnected isLocked } }');
    for (const item of result?.channels || []) {
      if (item.service === 'linkedin') console.log('LinkedIn channel metadata: ' + JSON.stringify({ id: item.id, name: item.name, displayName: item.displayName, type: item.type, externalLink: item.externalLink, isDisconnected: item.isDisconnected, isLocked: item.isLocked }));
      for (const network of ['x', 'linkedin']) {
        try {
          validateBufferChannel(network, item);
          console.log('VERIFIED DAJC ' + network + ' channel ID: ' + item.id);
          found++;
        } catch { /* Do not print unrelated personal account details. */ }
      }
    }
  }
  if (!found) console.log('No verified DAJC company X/LinkedIn channel connected to this Buffer account.');
  console.log('No posts created.');
} catch (error) { console.error('Buffer discovery: ' + error.message); process.exitCode = 1; }