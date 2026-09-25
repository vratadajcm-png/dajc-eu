// DAJC Weekly keeps the public Driving Bans Calendar separate from the
// EU Oversize Weekly editorial product. General HGV/truck bans (including
// holiday, weekend, seasonal and transit bans) must not be used to fill the
// Weekly. A ban/restriction is eligible here only when its supplied evidence
// explicitly scopes it to exceptional/oversize/abnormal/special transport.

const EXCEPTIONAL_SCOPE = /exceptional[- ]transport|exceptional[- ]vehicle|extraordinary[- ]transport|oversize|oversized|abnormal[- ]load|special[- ]transport|ausnahmetransport|schwertransport|gro[ßs]raum|sondertransport|convoi exceptionnel|transport exceptionnel|trasporto eccezionale|transporte especial|transporte excepcional|izvanredni prijevoz|nadrozm[eě]rn|nadmerný|special vehicle|permit-specific|escort requirement|pilot vehicle/i;

export function checkWeeklyDrivingBanPolicy(item = {}) {
  const isDrivingBan = Boolean(item.isDrivingBan || item.type === 'driving_ban');
  if (!isDrivingBan) return { ok: true };

  // Only fields that define what the restriction applies to. A general ban
  // often mentions exceptional transport in its impact/exemption notes (e.g.
  // "exceptional transports also need their own authorisation"), which does
  // not make the ban itself specific to exceptional transport.
  const text = [
    item.title,
    item.summary,
    item.whatChanged,
    item.vehicleScope,
  ].filter(Boolean).join(' ');

  if (EXCEPTIONAL_SCOPE.test(text)) return { ok: true };

  return {
    ok: false,
    reason: 'general Driving/Truck Ban belongs in the separate Driving Bans Calendar; EU Oversize Weekly only includes restrictions explicitly scoped to exceptional/oversize/special transport',
  };
}
