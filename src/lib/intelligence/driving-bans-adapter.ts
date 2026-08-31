import { drivingBanCalendars } from '../../../config/driving-ban-calendars/index.mjs';
import type { IntelligenceSourceAdapter, IntelligenceSourceSnapshot } from './source-adapter';
import type { IntelligenceSnapshotItem } from './change-detection';
import { dajcMaintainedDrivingBansRights } from './persistence-contract';

const DAY = 86_400_000;

export interface DrivingBanRule {
  id: string;
  country: string;
  countryName?: string;
  sourceUrl?: string;
  sourceName?: string;
  legalBasis?: string;
  vehicleScope?: string;
  routeScope?: string;
  exemptionNotes?: string;
  resolve(weekStart: Date, weekEnd: Date, year: number): {
    occurrences?: Array<{
      title: string;
      whatChanged?: string;
      validFrom: string;
      validTo: string;
      timeWindow?: string;
      impact?: string;
      recommendedAction?: string;
    }>;
    maintenanceError?: string;
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayOnOrBefore(date: Date): Date {
  const result = new Date(date);
  const day = result.getUTCDay();
  result.setUTCDate(result.getUTCDate() - ((day + 6) % 7));
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function startOfIsoDate(value: string): string {
  return `${value}T00:00:00.000Z`;
}

function endOfIsoDate(value: string): string {
  return `${value}T23:59:59.999Z`;
}

function isExceptionalRule(rule: DrivingBanRule): boolean {
  return /exceptional|special vehicle|oversize|abnormal/i.test(
    `${rule.id} ${rule.legalBasis ?? ''} ${rule.vehicleScope ?? ''}`,
  );
}

export function resolveDrivingBanRegistrySnapshot(args: {
  rules: DrivingBanRule[];
  from: string;
  to: string;
  observedAt: string;
}): IntelligenceSourceSnapshot {
  const from = new Date(`${args.from}T00:00:00.000Z`);
  const to = new Date(`${args.to}T23:59:59.999Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
    throw new Error('Invalid Driving Bans Intelligence date window');
  }

  const warnings: string[] = [];
  const items: IntelligenceSnapshotItem[] = [];
  const seen = new Set<string>();
  let complete = true;

  for (let week = mondayOnOrBefore(from); week <= to; week = new Date(week.getTime() + 7 * DAY)) {
    const weekEnd = new Date(week.getTime() + 6 * DAY);
    const year = week.getUTCFullYear();

    for (const rule of args.rules) {
      let resolved: ReturnType<DrivingBanRule['resolve']>;
      try {
        resolved = rule.resolve(week, weekEnd, year);
      } catch (error) {
        complete = false;
        warnings.push(`${rule.id}: resolve failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        continue;
      }

      if (resolved.maintenanceError) {
        complete = false;
        warnings.push(`${rule.id}: ${resolved.maintenanceError}`);
      }

      for (const occurrence of resolved.occurrences ?? []) {
        if (!occurrence.validFrom || !occurrence.validTo) {
          complete = false;
          warnings.push(`${rule.id}: occurrence missing validity dates`);
          continue;
        }
        if (occurrence.validTo < dateOnly(from) || occurrence.validFrom > dateOnly(to)) continue;

        const key = `${rule.id}|${occurrence.validFrom}|${occurrence.validTo}|${occurrence.timeWindow ?? occurrence.title}`;
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({
          key,
          jurisdiction: rule.country,
          topic: 'driving-ban',
          materiality: 'high',
          effectiveFrom: startOfIsoDate(occurrence.validFrom),
          effectiveTo: endOfIsoDate(occurrence.validTo),
          sourceUrl: rule.sourceUrl,
          sourceLabel: rule.sourceName,
          summary: occurrence.title,
          payload: {
            countryName: rule.countryName,
            legalBasis: rule.legalBasis,
            vehicleScope: rule.vehicleScope,
            routeScope: rule.routeScope,
            exemptionNotes: rule.exemptionNotes,
            timeWindow: occurrence.timeWindow,
            impact: occurrence.impact,
            recommendedAction: occurrence.recommendedAction,
            whatChanged: occurrence.whatChanged,
            exceptionalOrSpecial: isExceptionalRule(rule),
            validFromDate: occurrence.validFrom,
            validToDate: occurrence.validTo,
          },
        });
      }
    }
  }

  items.sort((a, b) =>
    (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? '')
    || a.jurisdiction.localeCompare(b.jurisdiction)
    || a.key.localeCompare(b.key));

  return {
    sourceId: 'dajc-driving-bans-registry',
    observedAt: args.observedAt,
    complete,
    provenance: {
      sourceLabel: 'DAJC maintained Driving Bans registry',
      distributionPolicy: 'internal-only',
    },
    items,
    warnings,
  };
}

export class DrivingBansRegistryAdapter implements IntelligenceSourceAdapter {
  readonly sourceId = 'dajc-driving-bans-registry';
  readonly rights = dajcMaintainedDrivingBansRights;

  constructor(
    private readonly from: string,
    private readonly to: string,
    private readonly observedAt = new Date().toISOString(),
  ) {}

  async fetchSnapshot(): Promise<IntelligenceSourceSnapshot> {
    return resolveDrivingBanRegistrySnapshot({
      rules: drivingBanCalendars as DrivingBanRule[],
      from: this.from,
      to: this.to,
      observedAt: this.observedAt,
    });
  }
}
