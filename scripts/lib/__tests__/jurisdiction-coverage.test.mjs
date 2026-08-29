import { describe, expect, it } from 'vitest';
import { oversizeSources } from '../../../config/oversize-sources/index.mjs';
import {
  coverageForSources,
  oversizeJurisdictions,
} from '../../../config/oversize-jurisdictions/index.mjs';

describe('mandatory geographic coverage registry', () => {
  it('contains every approved jurisdiction as a separate coverage item', () => {
    const names = new Set(oversizeJurisdictions.map((j) => j.nameCs));
    for (const required of [
      'Rakousko','Albánie','Andorra','Arménie','Ázerbájdžán','Belgie','Bulharsko',
      'Bosna a Hercegovina','Bělorusko','Kypr','Česko','Německo','Dánsko','Španělsko',
      'Estonsko','Francie','Finsko','Lichtenštejnsko','Spojené království','Gruzie',
      'Řecko','Maďarsko','Chorvatsko','Švýcarsko','Itálie','Irsko','Island',
      'Lucembursko','Litva','Lotyšsko','Malta','Monako','Moldavsko','Černá Hora',
      'Norsko','Nizozemsko','Severní Makedonie','Portugalsko','Polsko','Rumunsko',
      'Kosovo','Rusko','Švédsko','Slovensko','Slovinsko','Srbsko','Turecko','Ukrajina',
      'Vatikán','Kazachstán','Faerské ostrovy','Alandy','Gibraltar','Guernsey','Jersey',
      'Ostrov Man','Alderney','Akrotiri a Dekelia','Špicberky','Jan Mayen','Grónsko',
      'Azory','Madeira','Kanárské ostrovy','Ceuta','Melilla','Guadeloupe','Martinik',
      'Francouzská Guyana','Réunion','Mayotte','Saint-Martin','Saint-Barthélemy',
      'Saint-Pierre-et-Miquelon','Nová Kaledonie','Francouzská Polynésie',
      'Wallis a Futuna','Clipperton','Francouzská jižní a antarktická území',
      'Aruba','Curaçao','Sint Maarten','Bonaire','Saba','Sint Eustatius'
    ]) expect(names.has(required), required).toBe(true);
  });

  it('has no unmapped jurisdiction after source inheritance is applied', () => {
    const gaps = coverageForSources(oversizeSources).filter((j) => !j.covered);
    expect(gaps.map((j) => j.nameCs)).toEqual([]);
  });
});
