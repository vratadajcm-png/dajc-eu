export const MIN_ROUNDUP_REPORTS = 3;
export const MIN_ROUNDUP_COUNTRIES = 3;

export function roundupCountrySet(items = []) {
  return new Set(items.map((item) => String(item.country || '').trim()).filter(Boolean));
}

export function roundupNeedsSupplement(items = []) {
  const countries = roundupCountrySet(items);
  return {
    needsSupplement: items.length < MIN_ROUNDUP_REPORTS || countries.size < MIN_ROUNDUP_COUNTRIES,
    reportCount: items.length,
    countryCount: countries.size,
    neededCountries: Math.max(0, MIN_ROUNDUP_COUNTRIES - countries.size),
    countries,
  };
}

export function mergeRoundupSupplement(existing = [], supplement = [], usedSourceUrls = new Set()) {
  const merged = [...existing];
  const seenUrls = new Set([
    ...usedSourceUrls,
    ...existing.map((item) => item.sourceUrl).filter(Boolean),
  ]);
  const countries = roundupCountrySet(existing);

  // First use candidates that add a new country. This is what makes the
  // supplement a breadth repair rather than a way to add more reports from
  // the same already-covered market.
  for (const item of supplement) {
    if (!item?.sourceUrl || seenUrls.has(item.sourceUrl)) continue;
    const country = String(item.country || '').trim();
    if (!country || countries.has(country)) continue;
    merged.push(item);
    seenUrls.add(item.sourceUrl);
    countries.add(country);
    if (merged.length >= MIN_ROUNDUP_REPORTS && countries.size >= MIN_ROUNDUP_COUNTRIES) break;
  }

  return merged;
}

export function sanitizeRoundup(items = [], leadItems = [], { suppressEvergreenSunday = false } = {}) {
  const leadUrls = new Set(leadItems.map((item) => item.sourceUrl).filter(Boolean));
  const seenUrls = new Set();

  return items.filter((item) => {
    if (!item?.sourceUrl || leadUrls.has(item.sourceUrl) || seenUrls.has(item.sourceUrl)) return false;

    if (suppressEvergreenSunday) {
      const text = `${item.title || ''} ${item.whatChanged || ''}`;
      const looksEvergreen =
        /(?:routine|standard|standing|general|year[- ]round|regular).{0,40}(?:sunday|weekend)|(?:sunday|weekend).{0,40}(?:routine|standard|standing|general|year[- ]round|regular)/i.test(text);
      if (looksEvergreen && item.isDrivingBan) return false;
    }

    seenUrls.add(item.sourceUrl);
    return true;
  });
}
