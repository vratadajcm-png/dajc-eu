// Live Source Registry built from the existing registries. Metadata only:
// rules stay in data/driving-bans/canonical.json, jurisdictions in config/europe-coverage.mjs.
import { dajcEuropeCoverage } from '../europe-coverage.mjs';
import { officialAuthorityDomains } from '../official-authority-domains.mjs';
import { oversizeSources } from '../oversize-sources/index.mjs';
import { canonicalDrivingBans } from '../driving-ban-calendars/runtime.mjs';
import { targetedSourceReview } from '../driving-ban-calendars/verification.mjs';
import { providerCandidates, machineInterfaces, interoperabilityReferences } from './provider-candidates.mjs';
import { buildSourceCatalog, validateSourceCatalog } from '../../src/lib/driving-bans/source-registry.mjs';

export const buildDrivingBanSourceCatalog = (generatedAt = null) => buildSourceCatalog({
  canonical: canonicalDrivingBans, identities: dajcEuropeCoverage, authorityDomains: officialAuthorityDomains,
  oversizeSources, targetedReview: targetedSourceReview, providerCandidates, machineInterfaces, interoperabilityReferences, generatedAt,
});
export const drivingBanSourceCatalog = buildDrivingBanSourceCatalog();
validateSourceCatalog(drivingBanSourceCatalog, dajcEuropeCoverage);
