// Mandatory geographic coverage universe for EU Oversize Weekly.
// This registry follows the MPZ list approved by DAJC. Alternative MPZ codes
// are aliases of the same jurisdiction; territories remain separate entries so
// the monitor can prove that they were considered rather than silently folded
// into the administering state.
//
// sourceCountries uses the country code(s) currently present in
// config/oversize-sources. Direct local sources should be preferred where
// available; inherited coverage is an explicit fallback, never an omission.

export const oversizeJurisdictions = [
  { id: 'AT', mpz: ['A'], nameCs: 'Rakousko', sourceCountries: ['AT'] },
  { id: 'AL', mpz: ['AL'], nameCs: 'Albánie', sourceCountries: ['AL'] },
  { id: 'AD', mpz: ['AND'], nameCs: 'Andorra', sourceCountries: ['AD'] },
  { id: 'AM', mpz: ['AM'], nameCs: 'Arménie', sourceCountries: ['AM'] },
  { id: 'AZ', mpz: ['AZ'], nameCs: 'Ázerbájdžán', sourceCountries: ['AZ'] },
  { id: 'BE', mpz: ['B'], nameCs: 'Belgie', sourceCountries: ['BE'] },
  { id: 'BG', mpz: ['BG'], nameCs: 'Bulharsko', sourceCountries: ['BG'] },
  { id: 'BA', mpz: ['BIH'], nameCs: 'Bosna a Hercegovina', sourceCountries: ['BA'] },
  { id: 'BY', mpz: ['BY'], nameCs: 'Bělorusko', sourceCountries: ['BY'] },
  { id: 'CY', mpz: ['CY'], nameCs: 'Kypr', sourceCountries: ['CY'] },
  { id: 'CZ', mpz: ['CZ'], nameCs: 'Česko', sourceCountries: ['CZ'] },
  { id: 'DE', mpz: ['D'], nameCs: 'Německo', sourceCountries: ['DE'] },
  { id: 'DK', mpz: ['DK'], nameCs: 'Dánsko', sourceCountries: ['DK'] },
  { id: 'ES', mpz: ['E'], nameCs: 'Španělsko', sourceCountries: ['ES'] },
  { id: 'EE', mpz: ['EST'], nameCs: 'Estonsko', sourceCountries: ['EE'] },
  { id: 'FR', mpz: ['F'], nameCs: 'Francie', sourceCountries: ['FR'] },
  { id: 'FI', mpz: ['FIN'], nameCs: 'Finsko', sourceCountries: ['FI'] },
  { id: 'LI', mpz: ['FL'], nameCs: 'Lichtenštejnsko', sourceCountries: ['LI'] },
  { id: 'GB', mpz: ['GB', 'UK'], nameCs: 'Spojené království', sourceCountries: ['UK'] },
  { id: 'GE', mpz: ['GE'], nameCs: 'Gruzie', sourceCountries: ['GE'] },
  { id: 'GR', mpz: ['GR'], nameCs: 'Řecko', sourceCountries: ['GR'] },
  { id: 'HU', mpz: ['H'], nameCs: 'Maďarsko', sourceCountries: ['HU'] },
  { id: 'HR', mpz: ['HR'], nameCs: 'Chorvatsko', sourceCountries: ['HR'] },
  { id: 'CH', mpz: ['CH'], nameCs: 'Švýcarsko', sourceCountries: ['CH'] },
  { id: 'IT', mpz: ['I'], nameCs: 'Itálie', sourceCountries: ['IT'] },
  { id: 'IE', mpz: ['IRL'], nameCs: 'Irsko', sourceCountries: ['IE'] },
  { id: 'IS', mpz: ['IS'], nameCs: 'Island', sourceCountries: ['IS'] },
  { id: 'LU', mpz: ['L'], nameCs: 'Lucembursko', sourceCountries: ['LU'] },
  { id: 'LT', mpz: ['LT'], nameCs: 'Litva', sourceCountries: ['LT'] },
  { id: 'LV', mpz: ['LV'], nameCs: 'Lotyšsko', sourceCountries: ['LV'] },
  { id: 'MT', mpz: ['M'], nameCs: 'Malta', sourceCountries: ['MT'] },
  { id: 'MC', mpz: ['MC'], nameCs: 'Monako', sourceCountries: ['MC'] },
  { id: 'MD', mpz: ['MD'], nameCs: 'Moldavsko', sourceCountries: ['MD'] },
  { id: 'ME', mpz: ['MNE'], nameCs: 'Černá Hora', sourceCountries: ['ME'] },
  { id: 'NO', mpz: ['N'], nameCs: 'Norsko', sourceCountries: ['NO'] },
  { id: 'NL', mpz: ['NL'], nameCs: 'Nizozemsko', sourceCountries: ['NL'] },
  { id: 'MK', mpz: ['NMK', 'MK'], nameCs: 'Severní Makedonie', sourceCountries: ['MK'] },
  { id: 'PT', mpz: ['P'], nameCs: 'Portugalsko', sourceCountries: ['PT'] },
  { id: 'PL', mpz: ['PL'], nameCs: 'Polsko', sourceCountries: ['PL'] },
  { id: 'RO', mpz: ['RO'], nameCs: 'Rumunsko', sourceCountries: ['RO'] },
  { id: 'XK', mpz: ['RKS'], nameCs: 'Kosovo', sourceCountries: ['XK'] },
  { id: 'RU', mpz: ['RUS'], nameCs: 'Rusko', sourceCountries: ['RU'] },
  { id: 'SE', mpz: ['S'], nameCs: 'Švédsko', sourceCountries: ['SE'] },
  { id: 'SK', mpz: ['SK'], nameCs: 'Slovensko', sourceCountries: ['SK'] },
  { id: 'SI', mpz: ['SLO'], nameCs: 'Slovinsko', sourceCountries: ['SI'] },
  { id: 'RS', mpz: ['SRB'], nameCs: 'Srbsko', sourceCountries: ['RS'] },
  { id: 'TR', mpz: ['TR'], nameCs: 'Turecko', sourceCountries: ['TR'] },
  { id: 'UA', mpz: ['UA'], nameCs: 'Ukrajina', sourceCountries: ['UA'] },
  { id: 'VA', mpz: ['V'], nameCs: 'Vatikán', sourceCountries: ['VA', 'IT'] },
  { id: 'KZ', mpz: ['KZ'], nameCs: 'Kazachstán', sourceCountries: ['KZ'] },

  { id: 'FO', mpz: ['FO'], nameCs: 'Faerské ostrovy', sourceCountries: ['FO'] },
  { id: 'AX', mpz: ['AX'], nameCs: 'Alandy', sourceCountries: ['AX', 'FI'] },
  { id: 'GI', mpz: ['GBZ'], nameCs: 'Gibraltar', sourceCountries: ['GI', 'UK'] },
  { id: 'GG', mpz: ['GBG'], nameCs: 'Guernsey', sourceCountries: ['GG', 'UK'] },
  { id: 'JE', mpz: ['GBJ'], nameCs: 'Jersey', sourceCountries: ['JE', 'UK'] },
  { id: 'IM', mpz: ['GBM'], nameCs: 'Ostrov Man', sourceCountries: ['IM', 'UK'] },
  { id: 'ALDERNEY', mpz: ['GBA'], nameCs: 'Alderney', sourceCountries: ['GG', 'UK'] },
  { id: 'AKROTIRI-DHEKELIA', mpz: ['—'], nameCs: 'Akrotiri a Dekelia', sourceCountries: ['CY', 'UK'] },
  { id: 'SVALBARD', mpz: ['—'], nameCs: 'Špicberky', sourceCountries: ['NO'] },
  { id: 'JAN-MAYEN', mpz: ['—'], nameCs: 'Jan Mayen', sourceCountries: ['NO'] },
  { id: 'GL', mpz: ['KN'], nameCs: 'Grónsko', sourceCountries: ['GL', 'DK'] },

  { id: 'PT-AZORES', mpz: ['P'], nameCs: 'Azory', sourceCountries: ['PT'] },
  { id: 'PT-MADEIRA', mpz: ['P'], nameCs: 'Madeira', sourceCountries: ['PT'] },
  { id: 'ES-CANARY', mpz: ['E'], nameCs: 'Kanárské ostrovy', sourceCountries: ['ES'] },
  { id: 'ES-CEUTA', mpz: ['E'], nameCs: 'Ceuta', sourceCountries: ['ES'] },
  { id: 'ES-MELILLA', mpz: ['E'], nameCs: 'Melilla', sourceCountries: ['ES'] },

  { id: 'GP', mpz: ['F'], nameCs: 'Guadeloupe', sourceCountries: ['FR'] },
  { id: 'MQ', mpz: ['F'], nameCs: 'Martinik', sourceCountries: ['FR'] },
  { id: 'GF', mpz: ['F'], nameCs: 'Francouzská Guyana', sourceCountries: ['FR'] },
  { id: 'RE', mpz: ['F'], nameCs: 'Réunion', sourceCountries: ['FR'] },
  { id: 'YT', mpz: ['F'], nameCs: 'Mayotte', sourceCountries: ['FR'] },
  { id: 'MF', mpz: ['F'], nameCs: 'Saint-Martin', sourceCountries: ['FR'] },
  { id: 'BL', mpz: ['F'], nameCs: 'Saint-Barthélemy', sourceCountries: ['FR'] },
  { id: 'PM', mpz: ['F'], nameCs: 'Saint-Pierre-et-Miquelon', sourceCountries: ['FR'] },
  { id: 'NC', mpz: ['NC'], nameCs: 'Nová Kaledonie', sourceCountries: ['FR'] },
  { id: 'PF', mpz: ['PF'], nameCs: 'Francouzská Polynésie', sourceCountries: ['FR'] },
  { id: 'WF', mpz: ['F'], nameCs: 'Wallis a Futuna', sourceCountries: ['FR'] },
  { id: 'CLIPPERTON', mpz: ['F'], nameCs: 'Clipperton', sourceCountries: ['FR'] },
  { id: 'TF', mpz: ['F'], nameCs: 'Francouzská jižní a antarktická území', sourceCountries: ['FR'] },

  { id: 'AW', mpz: ['ARU', 'AUA'], nameCs: 'Aruba', sourceCountries: ['AW', 'NL'] },
  { id: 'CW', mpz: ['NA'], nameCs: 'Curaçao', sourceCountries: ['CW', 'NL'] },
  { id: 'SX', mpz: ['NA'], nameCs: 'Sint Maarten', sourceCountries: ['SX', 'NL'] },
  { id: 'BQ-BO', mpz: ['NL'], nameCs: 'Bonaire', sourceCountries: ['BQ', 'NL'] },
  { id: 'BQ-SA', mpz: ['NL'], nameCs: 'Saba', sourceCountries: ['BQ', 'NL'] },
  { id: 'BQ-SE', mpz: ['NL'], nameCs: 'Sint Eustatius', sourceCountries: ['BQ', 'NL'] },
];

export function coverageForSources(sources = []) {
  const configuredCountries = new Set(sources.map((source) => source.country));
  const configuredJurisdictions = new Set(
    sources.map((source) => source.jurisdictionId).filter(Boolean)
  );

  return oversizeJurisdictions.map((jurisdiction) => {
    const direct = configuredJurisdictions.has(jurisdiction.id);
    const coveredBy = jurisdiction.sourceCountries.filter((code) => configuredCountries.has(code));
    return {
      ...jurisdiction,
      direct,
      covered: direct || coveredBy.length > 0,
      coveredBy,
    };
  });
}
