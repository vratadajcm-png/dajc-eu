// Official LinkedIn Posts API. A company author URN is mandatory;
// personal member profiles are never an allowed fallback.
export const LINKEDIN_POSTS_URL = 'https://api.linkedin.com/rest/posts';
export const LINKEDIN_API_VERSION = '202607';

export function linkedinConfig(env = process.env) {
  const token = env.LINKEDIN_ACCESS_TOKEN;
  const organizationUrn = env.DAJC_LINKEDIN_ORGANIZATION_URN;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('LINKEDIN_ACCESS_TOKEN is missing (GitHub Actions secret)');
  }
  if (typeof organizationUrn !== 'string' || !/^urn:li:organization:[1-9]\d*$/.test(organizationUrn)) {
    throw new Error('DAJC_LINKEDIN_ORGANIZATION_URN must be a numeric company organization URN, never a person URN');
  }
  return { token, organizationUrn };
}

export function linkedinPostPayload(organizationUrn, text) {
  if (!/^urn:li:organization:[1-9]\d*$/.test(organizationUrn)) throw new Error('Refusing a non-company LinkedIn author');
  if (typeof text !== 'string' || !text.trim()) throw new Error('Refusing empty LinkedIn content');
  return {
    author: organizationUrn,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
}

export async function publishToLinkedIn(text, config, fetchFn = fetch) {
  const response = await fetchFn(LINKEDIN_POSTS_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + config.token,
      'Linkedin-Version': LINKEDIN_API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(linkedinPostPayload(config.organizationUrn, text)),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 201) {
    // Never log an API response body or bearer credentials.
    throw new Error('LinkedIn company Posts API returned HTTP ' + response.status + '; check company-page role, w_organization_social authorization, and token expiry. Reconcile an ambiguous response manually.');
  }
  const id = response.headers.get('x-restli-id');
  if (!/^urn:li:(?:share|ugcPost):\d+$/.test(id || '')) {
    throw new Error('LinkedIn reported success without a valid post ID; manual reconciliation required');
  }
  return { id, url: 'https://www.linkedin.com/feed/update/' + id + '/' };
}
