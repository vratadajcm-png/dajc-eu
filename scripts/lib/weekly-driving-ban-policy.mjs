// DAJC Weekly keeps the public Driving Bans Calendar separate from the
// EU Oversize Weekly editorial product. General HGV/truck bans (including
// holiday, weekend, seasonal and transit bans) must not be used to fill the
// Weekly. A ban/restriction is eligible here only when its supplied evidence
// explicitly scopes it to exceptional/oversize/abnormal/special transport.

const EXCEPTIONAL_SCOPE = /exceptional transport|exceptional vehicle|oversize|oversized|abnormal load|special transport|ausnahmetransport|schwertransport|gro[ßs]raum|sondertransport|convoi exceptionnel|transport exceptionnel|trasporto eccezionale|transporte especial|transporte excepcional|izvanredni prijevoz|nadrozm[eě]rn|nadmerný|special vehicle|permit-specific|escort requirement|pilot vehicle/i;

// General time-based truck bans, recognised from the wording itself so an
// item cannot slip through merely because nobody flagged it as a ban.
const GENERAL_BAN_WORDING = /driving bans?\b|weekend bans?\b|holiday bans?\b|sunday bans?\b|night(?:-time)? bans?\b|(?:lkw-|sonntags|feiertags|nacht|wochenend|ferienreise)?fahrverbot|interdictions? de circul|divieto di circolazione|divieti di circolazione|restricci[oó]n(?:es)? (?:a la|de) circulaci[oó]n|z[aá]kaz j[ií]zd|zakaz jazdy|z[aá]kaz jazdy|prepoved prometa za tovorna|zabrana prometa za teretn|vezet[eé]si tilalom|interdic[tț]i[ae] de circula[tț]ie|k[oø]rselsforbud|kj[oø]reforbud/i;

export function checkWeeklyDrivingBanPolicy(item = {}) {
  const text = [
    item.title,
    item.summary,
    item.whatChanged,
    item.vehicleScope,
    item.impact,
    item.exemptions,
  ].filter(Boolean).join(' ');

  const isDrivingBan = Boolean(item.isDrivingBan || item.type === 'driving_ban' || GENERAL_BAN_WORDING.test(text));
  if (!isDrivingBan) return { ok: true };

  if (EXCEPTIONAL_SCOPE.test(text)) return { ok: true };

  return {
    ok: false,
    reason: 'general Driving/Truck Ban belongs in the separate Driving Bans Calendar; EU Oversize Weekly only includes restrictions explicitly scoped to exceptional/oversize/special transport',
  };
}
