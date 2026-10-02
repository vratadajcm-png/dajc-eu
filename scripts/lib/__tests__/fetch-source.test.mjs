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

  it('does not classify "Pontificio" or "ponts et chaussées" as a bridge restriction', () => {
    const html = `
      <ul>
        <li><a href="/inno-pontificio">Inno Pontificio e la sua storia - traffico</a></li>
      </ul>
    `;
    const findings = extractHtmlFindings(html, { ...source, url: 'https://www.autobahn.de/' }, 'https://www.autobahn.de/');
    expect(findings.filter((f) => f.type === 'bridge_restriction')).toEqual([]);
  });

  it('records a publication date when the link URL carries one', () => {
    const html = '<p><a href="/files/ts_17.09.2026_most_zlate_moravce.pdf">SSC rekonštruuje most na ceste I/65 - obmedzenie premávky</a></p>';
    const findings = extractHtmlFindings(html, { ...source, url: 'https://www.autobahn.de/' }, 'https://www.autobahn.de/');
    expect(findings[0].publishedAt).toBe('2026-09-17');
    expect(findings[0].publishedAtSource).toBe('url');
  });
});
