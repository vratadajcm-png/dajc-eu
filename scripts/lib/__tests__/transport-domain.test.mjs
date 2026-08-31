import { describe, expect, it } from 'vitest';
import { checkTransportDomainRelevance } from '../transport-domain.mjs';

describe('road transport domain relevance', () => {
  it('rejects a generic water-law authorisation page', () => {
    expect(checkTransportDomainRelevance({
      type: 'permit_change',
      title: 'Publication des déclarations et autorisations au titre de la loi sur l’eau',
      summary: 'Environmental declarations and authorisations for water law.',
      sourceName: 'Prefecture',
    }).ok).toBe(false);
  });

  it('accepts Swiss private exceptional-transport escort regulation', () => {
    expect(checkTransportDomainRelevance({
      type: 'escort_requirement',
      title: 'Private Ausnahmetransportbegleitungen',
      summary: 'Nationwide rules for private escorts of exceptional transports.',
      sourceName: 'ASTRA',
    }).ok).toBe(true);
  });

  it('accepts a heavy-vehicle toll change', () => {
    expect(checkTransportDomainRelevance({
      type: 'permit_system',
      title: 'Via Toll update',
      summary: 'Electronic road toll system for heavy goods vehicles on the A14.',
    }).ok).toBe(true);
  });

  it('accepts official calendar findings', () => {
    expect(checkTransportDomainRelevance({
      isOfficialCalendar: true,
      title: 'Maintained restriction',
    }).ok).toBe(true);
  });
});
