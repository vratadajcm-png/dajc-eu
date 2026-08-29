// DAJC European Oversize Intelligence geographic coverage matrix.
// This intentionally includes sovereign states plus transport-relevant European
// territories / sub-jurisdictions whose road, permit, escort, ferry or border
// rules may differ from the parent state. It is a research coverage list, not
// a statement about diplomatic recognition or sovereignty.

export const dajcEuropeCoverage = [
  ['AL','Albania'],['AD','Andorra'],['AM','Armenia'],['AT','Austria'],['AZ','Azerbaijan'],
  ['BY','Belarus'],['BE','Belgium'],['BA','Bosnia and Herzegovina'],['BG','Bulgaria'],['HR','Croatia'],
  ['CY','Cyprus'],['CZ','Czechia'],['DK','Denmark'],['EE','Estonia'],['FI','Finland'],['FR','France'],
  ['GE','Georgia'],['DE','Germany'],['GR','Greece'],['HU','Hungary'],['IS','Iceland'],['IE','Ireland'],
  ['IT','Italy'],['KZ','Kazakhstan (European transport scope)'],['XK','Kosovo'],['LV','Latvia'],
  ['LI','Liechtenstein'],['LT','Lithuania'],['LU','Luxembourg'],['MT','Malta'],['MD','Moldova'],
  ['MC','Monaco'],['ME','Montenegro'],['NL','Netherlands'],['MK','North Macedonia'],['NO','Norway'],
  ['PL','Poland'],['PT','Portugal'],['RO','Romania'],['RU','Russia (European transport scope)'],
  ['SM','San Marino'],['RS','Serbia'],['SK','Slovakia'],['SI','Slovenia'],['ES','Spain'],['SE','Sweden'],
  ['CH','Switzerland'],['TR','Türkiye (European transport scope)'],['UA','Ukraine'],['UK','United Kingdom'],
  ['VA','Vatican City'],

  ['AX','Åland Islands'],['FO','Faroe Islands'],['GI','Gibraltar'],['GG','Guernsey'],['JE','Jersey'],
  ['IM','Isle of Man'],['SJ','Svalbard and Jan Mayen'],['GL','Greenland (European jurisdiction link)'],
  ['SBA','Akrotiri and Dhekelia'],['NCY','Northern Cyprus'],['CEU','Ceuta'],['MLL','Melilla'],
  ['AZO','Azores'],['MAD','Madeira'],['CAN','Canary Islands'],

  ['ENG','England'],['SCT','Scotland'],['WLS','Wales'],['NIR','Northern Ireland'],
  ['FBIH','Federation of Bosnia and Herzegovina'],['RSBA','Republika Srpska'],
  ['AB','Abkhazia'],['SO','South Ossetia'],['TRN','Transnistria'],['GAG','Gagauzia'],
  ['CAT','Catalonia'],['BAS','Basque Country'],['GAL','Galicia'],
  ['FLA','Flanders'],['WAL','Wallonia'],['BRU','Brussels-Capital Region'],
  ['RSM','Republic of San Marino road jurisdiction'],
];

export const dajcCoverageCodes = new Set(dajcEuropeCoverage.map(([code]) => code));

export function coverageName(code) {
  return dajcEuropeCoverage.find(([item]) => item === code)?.[1] || code;
}
