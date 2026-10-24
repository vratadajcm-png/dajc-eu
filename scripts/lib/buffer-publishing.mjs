// Buffer GraphQL posting adapter. No Buffer credential or connected social
// account is available simply because this source file exists.
// https://developers.buffer.com/guides/posts-and-scheduling.html
export const BUFFER_API_URL = 'https://api.buffer.com';
const CHANNEL_ID = /^[0-9a-f]{24}$/;

export function readBufferConfig(channel, env = process.env) {
  if (!['x', 'linkedin'].includes(channel)) throw new Error('Unsupported Buffer channel');
  const token = env.BUFFER_API_KEY;
  const channelId = channel === 'x' ? env.DAJC_BUFFER_X_CHANNEL_ID : env.DAJC_BUFFER_LINKEDIN_CHANNEL_ID;
  if (typeof token !== 'string' || !token.trim()) throw new Error('Missing BUFFER_API_KEY GitHub secret');
  if (typeof channelId !== 'string' || !CHANNEL_ID.test(channelId)) {
    throw new Error('Missing or invalid Buffer channel ID for ' + channel);
  }
  return { backend: 'buffer', channel, token, channelId };
}

async function bufferQuery(config, query, fetchFn = fetch) {
  const response = await fetchFn(BUFFER_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
    body: JSON.stringify({ query }),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Buffer API HTTP ' + response.status + '; verify OAuth-connected channel and Buffer API key');
  const body = await response.json();
  if (Array.isArray(body?.errors) && body.errors.length) {
    // Never dump a third-party body or API credential into workflow logs.
    throw new Error('Buffer GraphQL request refused; validate token and connected channel');
  }
  return body?.data;
}

export function validateBufferChannel(channel, details) {
  if (!details || !CHANNEL_ID.test(details.id || '')) throw new Error('Buffer channel not found');
  if (details.isDisconnected || details.isLocked) throw new Error('Buffer social channel is disconnected or locked');
  const link = String(details.externalLink || '');
  const name = String(details.name || details.displayName || '').toLowerCase().replace(/^@/, '').trim();
  if (channel === 'x') {
    if (details.service !== 'twitter' || details.type !== 'profile' ||
        name !== 'dajceu' || !/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/dajceu\/?$/i.test(link)) {
      throw new Error('Buffer X channel is not the official DAJC @DAJCeu profile');
    }
  } else {
    if (process.env.DAJC_LINKEDIN_TARGET === 'personal') {
      // Temporary, explicit exception approved by the owner. Never permit
      // arbitrary personal profiles or silently fall back from company page.
      if (details.id !== '6adc3c32778b240e2fa9f0bc' ||
          details.service !== 'linkedin' || details.type !== 'profile' ||
          link !== 'https://www.linkedin.com/in/miroslav-daj%C4%8D-034a4540a' ||
          name !== 'miroslav-dajč-034a4540a') {
        throw new Error('LinkedIn channel is not the explicitly approved personal DAJC author');
      }
      return true;
    }
    if (details.service !== 'linkedin' || details.type !== 'page' ||
        !/^https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-z0-9-]+\/?$/i.test(link) ||
        !/^(dajc|dajc platform|dajc\.eu)$/.test(name)) {
      throw new Error('Buffer LinkedIn channel is not a confirmed DAJC company page');
    }
  }
  return true;
}

export async function checkBufferChannel(config, fetchFn = fetch) {
  const query = 'query VerifyDajcBufferChannel { channel(input: { id: ' + JSON.stringify(config.channelId) +
    ' }) { id service type name displayName externalLink isDisconnected isLocked } }';
  const data = await bufferQuery(config, query, fetchFn);
  return validateBufferChannel(config.channel, data?.channel);
}

export async function publishViaBuffer(content, config, fetchFn = fetch) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('Empty social post');
  const query = 'mutation PublishApprovedDajcNews { createPost(input: { text: ' +
    JSON.stringify(content) + ', channelId: ' + JSON.stringify(config.channelId) +
    ', schedulingType: automatic, mode: shareNow }) { ' +
    '... on PostActionSuccess { post { id status } } ' +
    '... on MutationError { message } } }';
  const data = await bufferQuery(config, query, fetchFn);
  const response = data?.createPost;
  if (typeof response?.post?.id !== 'string' || !response.post.id) {
    throw new Error('Buffer refused or did not confirm the post; reconcile before any retry');
  }
  // Buffer may accept the post without the social platform having delivered it.
  // Never call this a confirmed live X/LinkedIn URL merely on queue acceptance.
  const sent = response.post.status === 'sent';
  return { id: response.post.id, url: null, status: sent ? 'published' : 'submitted' };
}
