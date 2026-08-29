import { describe, expect, it } from 'vitest';
import { extractHtmlFindings } from '../fetch-source.mjs';

const source = {
  id: 'de-autobahn',
  country: 'DE',
  authority: 'Autobahn GmbH des Bundes',
  name: 'Autobahn GmbH - Verkehrsmeldungen',
  url: 'https://www.autobahn.de/aktuelles/aktuell',
  type: 'national-road-authority',
  priority: 1,
};

describe('extractHtmlFindings', () => {
  it('extracts relevant same-authority restriction links from official HTML', () => {
    const html = `
      <main>
        <article>
          <p>A1 Verkehrsmeldung - works affect freight traffic.</p>
          <a href="/betrieb-verkehr/verkehrsmeldung/a1-wochenendsperrung">
            A1: Wochenendsperrung der Auffahrt Burscheid
          </a>
        </article>
      </main>
    `;

    const findings = extractHtmlFindings(
      html,
      source,
      'https://www.autobahn.de/betrieb-verkehr/verkehrsmeldungen'
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('road_closure');
    expect(findings[0].sourceUrl).toBe(
      'https://www.autobahn.de/betrieb-verkehr/verkehrsmeldung/a1-wochenendsperrung'
    );
    expect(findings[0].country).toBe('Germany');
  });

  it('rejects external links and irrelevant navigation', () => {
    const html = `
      <nav>
        <a href="/karriere">Karriere bei der Autobahn GmbH</a>
        <a href="https://example.com/road-closure">External road closure</a>
      </nav>
    `;

    const findings = extractHtmlFindings(html, source, source.url);
    expect(findings).toEqual([]);
  });

  it('deduplicates repeated links', () => {
    const html = `
      <a href="/betrieb-verkehr/verkehrsmeldung/a3-vollsperrung">A3: Vollsperrung wegen Bauarbeiten</a>
      <a href="/betrieb-verkehr/verkehrsmeldung/a3-vollsperrung">A3: Vollsperrung wegen Bauarbeiten</a>
    `;

    const findings = extractHtmlFindings(html, source, source.url);
    expect(findings).toHaveLength(1);
  });
});
