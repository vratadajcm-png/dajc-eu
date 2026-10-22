// DAJC Europe-linked road-freight monitoring: 76 operational jurisdictions.
// Includes relevant road transport, ferry links, and distinct local rules.
// Remote/unverifiable/non-European transport territories removed 2026-10-22.
// Jurisdiction does not imply diplomatic recognition or sovereignty.

export const dajcEuropeCoverage = [
  ['AL','Albania'],['AD','Andorra'],['AM','Armenia'],['AT','Austria'],['AZ','Azerbaijan'],
  ['BY','Belarus'],['BE','Belgium'],['BA','Bosnia and Herzegovina'],['BG','Bulgaria'],['HR','Croatia'],
  ['CY','Cyprus'],['CZ','Czechia'],['DK','Denmark'],['EE','Estonia'],['FI','Finland'],
  ['FR','France'],['GE','Georgia'],['DE','Germany'],['GR','Greece'],['HU','Hungary'],
  ['IS','Iceland'],['IE','Ireland'],['IT','Italy'],['KZ','Kazakhstan (European transport scope)'],['XK','Kosovo'],
  ['LV','Latvia'],['LI','Liechtenstein'],['LT','Lithuania'],['LU','Luxembourg'],['MT','Malta'],
  ['MD','Moldova'],['MC','Monaco'],['ME','Montenegro'],['NL','Netherlands'],['MK','North Macedonia'],
  ['NO','Norway'],['PL','Poland'],['PT','Portugal'],['RO','Romania'],['RU','Russia (European transport scope)'],
  ['SM','San Marino'],['RS','Serbia'],['SK','Slovakia'],['SI','Slovenia'],['ES','Spain'],
  ['SE','Sweden'],['CH','Switzerland'],['TR','Türkiye (European transport scope)'],['UA','Ukraine'],['UK','United Kingdom'],
  ['VA','Vatican City'],

  ['AX','Åland Islands'],['FO','Faroe Islands'],['GI','Gibraltar'],['GG','Guernsey'],['JE','Jersey'],
  ['IM','Isle of Man'],['ALDERNEY','Alderney'],['CEU','Ceuta'],['MLL','Melilla'],['AZO','Azores'],
  ['MAD','Madeira'],['CAN','Canary Islands'],



  ['ENG','England'],['SCT','Scotland'],['WLS','Wales'],['NIR','Northern Ireland'],['FBIH','Federation of Bosnia and Herzegovina'],
  ['RSBA','Republika Srpska'],['CAT','Catalonia'],['BAS','Basque Country'],['GAL','Galicia'],['FLA','Flanders'],
  ['WAL','Wallonia'],['BRU','Brussels-Capital Region'],['RSM','Republic of San Marino road jurisdiction'],
];

export const dajcCoverageCodes = new Set(dajcEuropeCoverage.map(([code]) => code));

export function coverageName(code) {
  return dajcEuropeCoverage.find(([item]) => item === code)?.[1] || code;
}


export const dajcCoverageMpz = {
  AT:['A'], AL:['AL'], AD:['AND'], AM:['AM'], AZ:['AZ'],
  BE:['B'], BG:['BG'], BA:['BIH'], BY:['BY'], CY:['CY'],
  CZ:['CZ'], DE:['D'], DK:['DK'], ES:['E'], EE:['EST'],
  FR:['F'], FI:['FIN'], LI:['FL'], UK:['GB','UK'], GE:['GE'],
  GR:['GR'], HU:['H'], HR:['HR'], CH:['CH'], IT:['I'],
  IE:['IRL'], IS:['IS'], LU:['L'], LT:['LT'], LV:['LV'],
  MT:['M'], MC:['MC'], MD:['MD'], ME:['MNE'], NO:['N'],
  NL:['NL'], MK:['NMK','MK'], PT:['P'], PL:['PL'], RO:['RO'],
  XK:['RKS'], RU:['RUS'], SE:['S'], SK:['SK'], SI:['SLO'],
  RS:['SRB'], TR:['TR'], UA:['UA'], VA:['V'], KZ:['KZ'],
  FO:['FO'], AX:['AX'], GI:['GBZ'], GG:['GBG'], JE:['GBJ'],
  IM:['GBM'], ALDERNEY:['GBA'], AZO:['P'], MAD:['P'], CAN:['E'],
  CEU:['E'], MLL:['E'],
};
