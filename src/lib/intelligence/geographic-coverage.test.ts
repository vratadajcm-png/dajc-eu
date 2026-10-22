import { describe, expect, it } from 'vitest';
import { intelligencePreferenceSchema, isRelevantChange } from './preferences';
import { validateSourceSnapshot } from './source-adapter';
import { InMemoryIntelligenceStateStore } from './store';
import { leaseOutboxRecord } from './delivery';

const change = {id:'old',jurisdiction:'JE',topic:'permit' as const,changeType:'added' as const,materiality:'high' as const,observedAt:'2026-10-22T10:00:00Z',summary:'Historical evidence'};
describe('shared Intelligence geographic boundary',()=>{
  it('rejects retired and duplicate preference/corridor codes',()=>{
    expect(intelligencePreferenceSchema.safeParse({jurisdictions:['JE']}).success).toBe(false);
    expect(intelligencePreferenceSchema.safeParse({jurisdictions:['DE','DE']}).success).toBe(false);
    expect(intelligencePreferenceSchema.safeParse({corridors:[{id:'old',label:'old',jurisdictions:['GI']}]}).success).toBe(false);
    expect(intelligencePreferenceSchema.safeParse({jurisdictions:['UK','XK','KZ']}).success).toBe(true);
  });
  it('suppresses old alerts and leases without deleting their audit history',async()=>{
    const preferences=intelligencePreferenceSchema.parse({alertTopics:['permit']});
    expect(isRelevantChange(change,preferences)).toBe(false);
    const candidate={id:'a',recipientId:'r',change,channels:['in-app' as const],createdAt:change.observedAt,dedupeKey:'a'};
    const record={candidate,state:'pending' as const,attemptCount:0,availableAt:change.observedAt};
    expect(leaseOutboxRecord({record,now:change.observedAt})).toMatchObject({state:'suppressed',lastErrorCode:'outside-monitoring-scope'});
    const store=new InMemoryIntelligenceStateStore();
    await store.commitCycle({sourceId:'source',snapshot:[],historyEntries:[{change}],alertCandidates:[candidate]});
    expect(store.getHistory()).toEqual([{change}]);
    expect(store.getOutbox()).toEqual([]);
  });
  it('rejects out-of-scope provider snapshots before creating new work',()=>{
    expect(()=>validateSourceSnapshot({sourceId:'source',observedAt:change.observedAt,complete:true,provenance:{sourceLabel:'source',distributionPolicy:'unknown'},warnings:[],items:[{key:'a',jurisdiction:'GI',topic:'route-restriction',materiality:'high',summary:'old',payload:{}}]})).toThrow(/Untracked/);
  });
});
