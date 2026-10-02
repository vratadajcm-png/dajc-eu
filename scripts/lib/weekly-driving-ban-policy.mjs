// DAJC Weekly keeps the public Driving Bans Calendar separate from the
// EU Oversize Weekly editorial product. General HGV/truck bans (including
// holiday, weekend, seasonal and transit bans) must not be used to fill the
// Weekly. A ban/restriction is eligible here only when its supplied evidence
// explicitly scopes it to exceptional/oversize/abnormal/special transport.

const EXCEPTIONAL_SCOPE = /exceptional transport|exceptional vehicle|oversize|oversized|abnormal load|special transport|ausnahmetransport|schwertransport|gro[ßs]raum|sondertransport|convoi exceptionnel|transport exceptionnel|trasporto eccezionale|transporte especial|transporte excepcional|izvanredni prijevoz|nadrozm[eě]rn|nadmerný|special vehicle|permit-specific|escort requirement|pilot vehicle/i;

// General time-based truck bans, recognised from the wording itself so an
// item cannot slip through merely because nobody flagged it as a ban.
const GENERAL_BAN_WORDING = /driving bans?\b|weekend bans?\b|holiday bans?\b|sunday bans?\b|night(?:-time)? bans?\b|(?:lkw-|sonntags|feiertags|nacht|wochenend|ferienreise)?fahrverbot|interdictions? de circul|divieto di circolazione|divieti di circolazione|restricci[oó]n(?:es)? (?:a la|de) circulaci[oó]n|z[aá]kaz j[ií]zd|zakaz jazdy|z[aá]kaz jazdy|prepoved prometa za tovorna|zabrana prometa za teretn|vezet[eé]si tilalom|interdic[tț]i[ae] de circula[tț]ie|k[oø]rselsforbud|kj[oø]reforbud/i;

const BAN_WORD = '(?:prohibit\\w*|bans?|banned|verbot\\w*|fahrverbot|zakaz\\w*|z[aá]kaz\\w*|interdi\\w*|divieto|vietat\\w*|prohib\\w*|prepoved\\w*|zabran\\w*|tilalom|tilos)';
const BAN_TIME = '(?:sundays?|sonntags?|holidays?|public holidays?|bank holidays?|feiertags?|weekends?|wochenendes?|nights?|nachts?|ned[eě]l\\w*|sv[aá]t\\w*|sviat\\w*|niedziel\\w*|[sś]wi[aą]t\\w*|dimanches?|jours? f[eé]ri[eé]s?|nuit|domenic\\w*|festiv\\w*|notte|domingos?|festivos?|noche|nedelj\\w*|praznik\\w*|vas[aá]rnap\\w*|[uü]nnep\\w*)';

// Time-based general truck restrictions phrased without the word "ban":
// "Lkw über 7,5 t: sonntags Durchfahrt verboten", "holiday HGV ban". A
// weight/dimension restriction on a route ("bridge closed to vehicles over
// 7.5 t") is NOT a driving ban - it is route intelligence judged on its own.
const GENERAL_BAN_PHRASING = new RegExp(`${BAN_TIME}[^.]{0,60}${BAN_WORD}|${BAN_WORD}[^.]{0,60}${BAN_TIME}`, 'i');

export function checkWeeklyDrivingBanPolicy(item = {}) {
  const text = [
    item.title,
    item.summary,
    item.whatChanged,
    item.vehicleScope,
    item.impact,
    item.exemptions,
  ].filter(Boolean).join(' ');

  const isDrivingBan = Boolean(
    item.isDrivingBan || item.type === 'driving_ban' || GENERAL_BAN_WORDING.test(text) || GENERAL_BAN_PHRASING.test(text)
  );
  if (!isDrivingBan) return { ok: true };

  if (EXCEPTIONAL_SCOPE.test(text)) return { ok: true };

  return {
    ok: false,
    reason: 'general Driving/Truck Ban belongs in the separate Driving Bans Calendar; EU Oversize Weekly only includes restrictions explicitly scoped to exceptional/oversize/special transport',
  };
}
