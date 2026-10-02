import { describe, expect, it } from 'vitest';
import { checkIngestionRoadContext, checkTransportDomainRelevance } from '../transport-domain.mjs';

describe('heavy-transport domain relevance (publication gate)', () => {
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

  it('accepts a bridge weight limit for lorries', () => {
    expect(checkTransportDomainRelevance({
      title: 'Brücke Lennetal: Sperrung für Fahrzeuge über 7,5 t',
      summary: 'Die Talbrücke ist ab sofort für Lkw über 7,5 t gesperrt.',
    }).ok).toBe(true);
  });

  // Regressions from the W41 edition: each reached the article only because
  // generic words or the publishing authority's name counted as context.
  it.each([
    ['Tartu ja Elva vahel valmis uus jalg- ja jalgrattatee ning jalakäijate tunnel', 'Uus jalgratta- ja jalakäijate tunnel valmis.', 'Estonian Transport Administration'],
    ['Batteridrevne hjullastere imponerer i tunnel', 'Batteridrevne hjullastere brukes i tunnelprosjektet.', 'Statens vegvesen - Nyheter'],
    ['Le gouvernement luxembourgeois Administration des ponts et chaussées', 'L’Administration des ponts et chaussées est chargée de la gestion du réseau routier.', 'Luxembourg Roads Administration'],
    ['Conférence de rentrée du Gouvernement Princier', 'Poursuivre la mise en œuvre de la stratégie numérique.', 'Gouvernement de Monaco - Actualites'],
    ['Guidance: Explosive detection systems (EDS) for aviation security', 'Approved explosive detection systems to screen hold baggage and cargo.', 'GOV.UK - Department for Transport news'],
    ['Great British Railways sets course for rail freight growth', 'Rail freight growth target for 2040.', 'GOV.UK - Department for Transport news'],
  ])('rejects "%s"', (title, summary, sourceName) => {
    expect(checkTransportDomainRelevance({ title, summary, sourceName }).ok).toBe(false);
  });

  it('never counts the source name as transport context', () => {
    expect(checkTransportDomainRelevance({
      title: 'Annual report on staff training',
      summary: 'The administration trained its staff.',
      sourceName: 'National Roads and Heavy Transport Authority',
    }).ok).toBe(false);
  });

  it('accepts a motorway closure only with a proven duration longer than 30 days', () => {
    const closure = {
      title: 'A13 tunnel full closure for reinforcement works',
      summary: 'The motorway tunnel is closed to traffic.',
      type: 'road_closure',
    };
    expect(checkTransportDomainRelevance(closure).ok).toBe(false);
    expect(checkTransportDomainRelevance({ ...closure, validFrom: '2026-11-16', validTo: '2027-08-31' }).ok).toBe(true);
  });
});

describe('monitor ingestion context (data collection only)', () => {
  it('keeps recording road notices from road authorities as before', () => {
    expect(checkIngestionRoadContext({ title: 'A3: Vollsperrung wegen Bauarbeiten', sourceName: 'Autobahn GmbH - Verkehrsmeldungen' }).ok).toBe(true);
  });
});
