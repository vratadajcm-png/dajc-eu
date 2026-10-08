import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkFreshness,
  checkNotPreviouslyPublished,
  checkSourceSuitability,
  checkSpecificDevelopment,
  checkWeeklyEligibility,
  editionFreshSince,
} from '../weekly-eligibility.mjs';
import { loadPreviousEditionSources } from '../previous-editions.mjs';
import { oversizeSources } from '../../../config/oversize-sources/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTICLES_DIR = path.resolve(__dirname, '..', '..', '..', 'src', 'content', 'news', 'eu-oversize');

// The W41 edition was prepared on Thursday 1 October 2026 for 5-11 October.
const now = new Date('2026-10-01T10:13:12Z');
const weekStart = new Date('2026-10-05T00:00:00Z');
const weekEnd = new Date('2026-10-11T00:00:00Z');
const sourceByName = new Map(oversizeSources.map((s) => [s.name, s]));
const sourceMetaFor = (c) => sourceByName.get(c.sourceName) || null;

async function w41Context() {
  const previousEditions = await loadPreviousEditionSources({ articlesDir: ARTICLES_DIR, excludeSlugs: ['eu-oversize-weekly-2026-w41'] });
  return { now, weekStart, weekEnd, previousEditions, sourceMetaFor };
}

const fresh = {
  country: 'Austria',
  type: 'permit_change',
  title: 'Neue Bewilligungspflicht für Sondertransporte über 44 t auf der A13',
  summary: 'Ab 12. Oktober 2026 benötigen Sondertransporte über 44 t auf der A13 eine zusätzliche Bewilligung.',
  sourceUrl: 'https://www.asfinag.at/news/sondertransporte-a13-bewilligung/',
  sourceName: 'ASFINAG - Presse',
  publishedAt: '2026-09-30',
  status: 'new',
};

// Every item published in the original W41 edition, with the source metadata
// the fixed monitor records for it. None of them may ever be published again.
const W41_PUBLISHED_ITEMS = [
  ['Switzerland', 'driving_ban', 'Vereinfachte Bewilligung von Ausnahmetransporten und Anpassungen bei Fahrverboten', 'Ab dem 1. Juli 2026 werden Bewilligungen für Ausnahmetransporte in einem vereinfachten Verfahren erteilt.', 'https://www.astra.admin.ch/de/newnsb/rEO-ipY0tkkG', 'ASTRA - Medienmitteilungen', '2026-05-06'],
  ['Czechia', 'border_restriction', 'Charged Motorways Network Extends with Newly Finished Construction Projects since 1 September', 'Since 1 September 2026, the network of roads charged with toll for vehicles over 3.5 t extends.', 'https://www.czechtoll.cz/charged-motorways-network-extends-with-newly-finished-construction-projects-since-1-september/', 'CzechToll - electronic tolling operator', '2026-08-31'],
  ['Germany', 'infrastructure', 'POL-HL: HL-OH / Folgemeldung Verkehrshinweis: Ausfall Schwertransport am Donnerstag - keine Verkehrsbeeinträchtigungen mehr erwartbar', 'Der für Donnerstag angekündigte Schwertransport auf der Siemser Landstraße findet nicht statt.', 'https://www.presseportal.de/blaulicht/pm/43738/6362929', 'Presseportal - Polizeipresse (Blaulicht)', '2026-10-01'],
  ['Slovakia', 'bridge_restriction', 'SSC rekonštruuje most na ceste I/65 pri Zlatých Moravciach', 'Slovenská správa ciest začala rekonštrukciu mosta na ceste I/65.', 'https://www.ssc.sk/files/documents/tlacove_spravy/ts_17.09.2026_1_65_most_zlate_moravce.pdf', 'Slovak Road Administration - Press releases', '2026-09-17'],
  ['France', 'tunnel_restriction', 'A13 - tunnel de St Cloud', 'Fermeture du tube nord du tunnel de Saint-Cloud à partir du 16 novembre 2026 jusqu’à fin août 2027.', 'https://www.bison-fute.gouv.fr/a13-tunnel-de-st-cloud.html', 'Bison Fute - traffic restrictions', null],
  ['Norway', 'tunnel_restriction', 'Batteridrevne hjullastere imponerer i tunnel', 'Batteridrevne hjullastere brukes i tunnelarbeidet på E6 Megården–Sommerset.', 'https://www.vegvesen.no/vegprosjekter/europaveg/e6megardenmorsvikbotn/e6megardensommerset/nyhetsarkiv-for-e6-megarden-sommerset/batteridrevne-hjullastere-imponerer-i-tunnel/', 'Statens vegvesen - Nyheter', '2026-09-29'],
  ['Lithuania', 'infrastructure', '„Via Toll“ sistema pristatyta ūkininkų atstovams', 'Via Toll kelių rinkliavos sistema pristatyta ūkininkų atstovams.', 'https://vialietuva.lt/naujienos/via-toll/via-toll-sistema-pristatyta-ukininku-atstovams', 'Via Lietuva (Lithuanian Road Administration)', '2026-09-17'],
  ['Estonia', 'tunnel_restriction', 'Tartu ja Elva vahel valmis uus jalg- ja jalgrattatee ning jalakäijate tunnel', 'Tartu ja Elva vahel valmis uus jalg- ja jalgrattatee ning jalakäijate tunnel.', 'https://www.transpordiamet.ee/uudised/tartu-ja-elva-vahel-valmis-uus-jalg-ja-jalgrattatee-ning-jalakaijate-tunnel', 'Estonian Transport Administration', '2026-09-28'],
  ['United Kingdom', 'roadworks', 'Updating the safety at street works and road works code of practice', 'Seeks views on proposed updates to the safety at street works and road works code of practice.', 'https://www.gov.uk/government/consultations/updating-the-safety-at-street-works-and-road-works-code-of-practice', 'GOV.UK - Department for Transport news', '2026-09-21'],
  ['Slovenia', 'roadworks', 'Promet.si', 'Current roadworks on Slovenian roads and motorways.', 'https://www.promet.si/en/current-roadworks', 'Promet.si - official Slovenian traffic information', null],
  ['Norway', 'tunnel_restriction', 'Batteridrevne hjullastere', 'Batteridrevne hjullastere i tunnelprosjektet E134 Røldal–Seljestad.', 'https://www.vegvesen.no/nn/vegprosjekt/europaveg/e134vagsliseljestad/e134roldalseljestad/nyheitsarkiv/batteridrevne-hjullastere/', 'Statens vegvesen - Nyheter', '2026-09-30'],
  ['Bosnia and Herzegovina', 'tunnel_restriction', 'Izgradnja Južne Obilaznice Mostara, dionica Miljkovići - Rodoč veza na M17, poddionica tunel Novi', 'Izgradnja južne obilaznice Mostara s tunelom i privremenom vezom na lokalnu cestu.', 'https://jpdcfbh.ba/bs/projekti/izgradnja-juzne-obilaznice-mostara-dionica-miljkovici-rodoc-veza-na-m17-poddionica-tunel-novi-p305a-cvor-rodoc-p386-sa-izgradnjom-privremene-veze-na-postojecu-lokalnu-cestu/521', 'Roads of the Federation of Bosnia and Herzegovina', null],
  ['Montenegro', 'tunnel_restriction', 'Cjenovnik Tunel “Sozina”', 'Cijena prolaska kroz tunel Sozina za teretna vozila i autobuse po kategorijama.', 'https://monteput.me/cjenovnik-tunel-sozina/', 'Monteput Montenegro', '2023-03-16'],
  ['Slovakia', 'bridge_restriction', 'SSC otvorila nový most v Seredi', 'Slovenská správa ciest otvorila nový most v Seredi na ceste I/62.', 'https://www.ssc.sk/files/documents/tlacove_spravy/ts_03.08.2026_otvorenie_most_sered.pdf', 'Slovak Road Administration - Press releases', '2026-08-03'],
  ['Croatia', 'bridge_restriction', 'Izvanredni prijevoz', 'Uvjeti i način izdavanja dozvola za izvanredni prijevoz.', 'https://hrvatske-ceste.hr/hr/stranice/zahtjevi-i-suglasnosti/izvanredni-prijevoz/2', 'Croatian Roads', null],
  ['Luxembourg', 'bridge_restriction', 'Renouvellement de la couche de roulement sur la N11 entre Waldhaff et Gonderange', 'Fermeture de la N11 pour le renouvellement de la couche de roulement du 14.09.2026 au 26.09.2026.', 'https://pch.gouvernement.lu/fr/actualites.gouvernement2024%2Bfr%2Bactualites%2Btoutes_actualites%2Bcommuniques%2B2026%2B09-septembre%2B09-apc-n11.html', 'Luxembourg Roads Administration', '2026-09-09'],
  ['Montenegro', 'bridge_restriction', 'RADOVI NA ODRŽAVANJU KOLOVOZA NA AUTO-PUTA', 'Planirane aktivnosti redovnog održavanja kolovoza na auto-putu, uključujući teretna vozila.', 'https://monteput.me/obavjestenje-o-planiranim-radovima-na-odrzavanju-kolovoza-na-auto-putu/', 'Monteput Montenegro', '2026-06-23'],
  ['Switzerland', 'escort_requirement', 'Bundesrat will schweizweite Vorgaben für private Ausnahmetransportbegleitungen', 'Der Bundesrat will die Vorgaben für private Ausnahmetransportbegleitungen schweizweit vereinheitlichen.', 'https://www.astra.admin.ch/de/newnsb/lXxVvBz-pCb1SILobeHmP', 'ASTRA - Medienmitteilungen', '2026-08-19'],
  ['Switzerland', 'escort_requirement', 'Private Ausnahmetransportbegleitungen', 'Vorgaben für private Ausnahmetransportbegleitungen.', 'https://www.astra.admin.ch/de/private-ausnahmetransportbegleitungen', 'ASTRA - Medienmitteilungen', '2026-08-19'],
  ['Switzerland', 'escort_requirement', 'Vorlage UVEK-Verordnung zur Ausnahmetransportbegleitung ATBV PDF 437.43 kB 19. August 2026', 'Entwurf der Verordnung über die Ausnahmetransportbegleitung.', 'https://www.astra.admin.ch/dam/de/sd-web/hfsdfHByLwHl/Vorlage%20UVEK-Verordnung%20zur%20Ausnahmetransportbegleitung%20ATBV.pdf', 'ASTRA - Medienmitteilungen', null],
  ['Germany', 'bridge_restriction', 'Brückenkompetenzzentrum', 'Das Brückenkompetenzzentrum verfolgt das bundesweite Brückenmodernisierungsprogramm.', 'https://www.autobahn.de/planen-bauen/brueckenkompetenzzentrum', 'Autobahn GmbH - Aktuelles', null],
  ['Croatia', 'bridge_restriction', 'Obavijest za korisnike plovnog puta u morskom prostoru Most kopno - otok Čiovo', 'Obavijest za korisnike plovnog puta ispod mosta kopno - otok Čiovo.', 'https://hrvatske-ceste.hr/hr/stranice/zahtjevi-i-suglasnosti/dokumenti/68-obavijest-za-korisnike-plovnog-puta-u-morskom-prostoru-most-kopno-otok-ciovo', 'Croatian Roads', null],
  ['Montenegro', 'tunnel_restriction', 'Promet vozila – tunel “Sozina”', 'Promet vozila kroz tunel Sozina za posljednjih sedam dana.', 'https://monteput.me/promet-vozila-tunel-sozina/', 'Monteput Montenegro', '2023-02-20'],
  ['Lithuania', 'infrastructure', '„Via Toll“ projekto rugsėjo mėn. naujienlaiškis', 'Via Toll kelių rinkliavos projekto naujienlaiškis.', 'https://vialietuva.lt/naujienos/via-toll/via-toll-projekto-rugsejo-men-naujienlaiskis', 'Via Lietuva (Lithuanian Road Administration)', '2026-09-16'],
  ['Jersey', 'tunnel_restriction', 'Esplanade and Gloucester Street reconstruction works', 'We will rebuild the Esplanade road at the Gloucester Street junction.', 'https://www.gov.je/Travel/Roads/RoadClosures/Pages/GloucesterEsplanade.aspx', 'Jersey road closures and delays', null],
  ['Monaco', 'roadworks', 'Conférence de rentrée du Gouvernement Princier', 'Poursuivre la mise en œuvre de la stratégie numérique, adapter les politiques publiques.', 'https://www.gouv.mc/actualites/conference-de-rentree-du-gouvernement-princier', 'Gouvernement de Monaco - Actualites', '2026-09-18'],
  ['Switzerland', 'operational_change', 'Neuerungen im Strassenverkehr 2026', 'Ab dem 1. Januar 2026 treten verschiedene Änderungen im Strassenverkehrsrecht in Kraft, auch für Lastwagen.', 'https://www.astra.admin.ch/de/newnsb/86e_36JfUJm05rKGZu0qx', 'ASTRA - Medienmitteilungen', '2025-12-11'],
  ['Luxembourg', 'bridge_restriction', 'Le gouvernement luxembourgeois Administration des ponts et chaussées', 'L’Administration des ponts et chaussées est chargée de la gestion du réseau routier et des ouvrages d’art.', 'https://pch.gouvernement.lu/fr.html', 'Luxembourg Roads Administration', '2026-09-24'],
  ['AM', 'bridge_restriction', 'Bagratashen border supervision crossing point new bridge construction project', 'Construction of the new bridge at the Bagratashen border crossing point for freight traffic.', 'https://armroad.am/en/projects/bagratashen-border-supervision-crossing-point-new-bridge-construction-project', 'Armenia Road Department - News', null],
  ['Guernsey', 'road_closure', 'Traffic & Highways Road Information Map', 'Road information map: road works, resurfacing and embargoes.', 'https://roadworks.gov.gg/GSW/Roadworks.htm', 'Guernsey road closures and delays', null],
].map(([country, type, title, summary, sourceUrl, sourceName, publishedAt]) => ({
  country, type, title, summary, sourceUrl, sourceName, publishedAt, status: 'active',
}));

describe('W41 regression: none of the published filler may pass again', () => {
  it('covers all 30 items of the original edition', () => {
    expect(W41_PUBLISHED_ITEMS).toHaveLength(30);
  });

  it.each(W41_PUBLISHED_ITEMS.map((item) => [item.title, item]))('rejects "%s"', async (_title, item) => {
    const result = checkWeeklyEligibility(item, await w41Context());
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('still accepts a genuine, recently published exceptional-transport change', async () => {
    expect(checkWeeklyEligibility(fresh, await w41Context())).toEqual({ ok: true, freshness: 'published' });
  });
});

describe('checkFreshness', () => {
  it('accepts a source published within the last 7 days', () => {
    expect(checkFreshness({ publishedAt: '2026-09-24' }, { now }).ok).toBe(true);
  });

  it('rejects a source published more than 7 days ago', () => {
    expect(checkFreshness({ publishedAt: '2026-09-23' }, { now }).reason).toMatch(/older than the 7-day freshness window/);
  });

  it('rejects a page published earlier, however recently it was discovered', () => {
    const result = checkFreshness({ publishedAt: '2026-09-16', status: 'new', firstSeenAt: '2026-09-30T06:00:00Z' }, { now });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/newly discovered old page is not news/);
  });

  it('rejects undated material', () => {
    expect(checkFreshness({ publishedAt: null }, { now }).reason).toMatch(/undated material is never published/);
  });

  it('accepts an earlier-announced change that begins or ends in the target week', () => {
    const ctx = { now, weekStart, weekEnd };
    expect(checkFreshness({ publishedAt: '2026-08-01', validFrom: '2026-10-06' }, ctx).ok).toBe(true);
    expect(checkFreshness({ publishedAt: '2026-08-01', validTo: '2026-10-09' }, ctx).ok).toBe(true);
    expect(checkFreshness({ publishedAt: '2026-08-01', validFrom: '2026-11-16' }, ctx).ok).toBe(false);
  });

  it('accepts a change taking effect up to one month after preparation, not later', () => {
    const ctx = { now, weekStart, weekEnd };
    expect(checkFreshness({ publishedAt: '2026-08-01', validFrom: '2026-10-31' }, ctx)).toMatchObject({ ok: true, basis: 'outlook' });
    expect(checkFreshness({ publishedAt: '2026-08-01', validFrom: '2026-11-01' }, ctx).ok).toBe(false);
  });
});

describe('checkSpecificDevelopment', () => {
  it.each([
    'https://pch.gouvernement.lu/fr.html',
    'https://www.presseportal.de/regional/Duisburg',
    'https://www.presseportal.de/blaulicht/nr/50510',
    'https://armroad.am/en/projects/bagratashen-new-bridge',
    'https://www.autobahn.de/planen-bauen/faq-bruecken-1',
    'https://www.gov.je/travel/roads/roadclosures',
  ])('rejects the landing/listing/project page %s', (sourceUrl) => {
    expect(checkSpecificDevelopment({ sourceUrl, title: 'Some long enough page title here' }).ok).toBe(false);
  });

  it('accepts a specific news article', () => {
    expect(checkSpecificDevelopment({ sourceUrl: fresh.sourceUrl, title: fresh.title }).ok).toBe(true);
  });

  it('accepts a CMS item addressed by query string on the site root', () => {
    expect(checkSpecificDevelopment({ sourceUrl: 'https://www.arrsh.gov.al/?p=12345', title: 'New permit rules for exceptional transports' }).ok).toBe(true);
  });
});

describe('checkSourceSuitability', () => {
  const police = { type: 'police' };
  it('rejects single local police reports', () => {
    expect(checkSourceSuitability({ title: 'Schwertransport: Sperrung der B 75 in der Nacht' }, police).ok).toBe(false);
  });
  it('accepts an announced truck enforcement campaign', () => {
    expect(checkSourceSuitability({ title: 'ROADPOL Truck & Bus: Lkw-Kontrollwoche vom 5. bis 11. Oktober' }, police).ok).toBe(true);
  });
});

describe('checkNotPreviouslyPublished', () => {
  const previous = new Map([['https://example.test/a', { slug: 'eu-oversize-weekly-2026-w40', publishedAt: '2026-09-25T10:00:00.000Z' }]]);
  it('rejects a source already published in an earlier edition', () => {
    expect(checkNotPreviouslyPublished({ sourceUrl: 'https://example.test/a', publishedAt: '2026-09-20' }, previous).reason)
      .toMatch(/already published in eu-oversize-weekly-2026-w40/);
  });
  it('allows the source again when it was republished after that edition', () => {
    expect(checkNotPreviouslyPublished({ sourceUrl: 'https://example.test/a', publishedAt: '2026-09-30' }, previous).ok).toBe(true);
  });
});

describe('editionFreshSince', () => {
  const slot = new Date('2026-10-02T10:00:00Z'); // Friday 12:00 Prague
  it('anchors a late (Friday/Saturday) run to the Thursday preparation day', () => {
    expect(editionFreshSince(new Date('2026-10-02T12:17:00Z'), slot).toISOString().slice(0, 10)).toBe('2026-09-24');
    expect(editionFreshSince(new Date('2026-10-03T06:17:00Z'), slot).toISOString().slice(0, 10)).toBe('2026-09-24');
  });
  it('uses the run day itself for an earlier run', () => {
    expect(editionFreshSince(new Date('2026-10-01T03:17:00Z'), slot).toISOString().slice(0, 10)).toBe('2026-09-24');
    expect(editionFreshSince(new Date('2026-09-28T09:00:00Z'), slot).toISOString().slice(0, 10)).toBe('2026-09-21');
  });
});

describe('binary documents are never content', () => {
  it('ignores a PDF read as text when judging scope', async () => {
    const pdfBytes = '%PDF-1.7 %��� 1 0 obj stream x��]Yo9~7 7,5 t Lkw ��';
    const item = { ...fresh, title: 'SSC zrekonštruuje most na ceste I/65 pri Zlatých Moravciach', summary: pdfBytes, sourceUrl: 'https://www.ssc.sk/files/ts_17.09.2026_most.pdf', publishedAt: '2026-09-29' };
    const result = checkWeeklyEligibility(item, await w41Context());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no demonstrated heavy\/abnormal\/oversize road-transport context/);
  });
});
