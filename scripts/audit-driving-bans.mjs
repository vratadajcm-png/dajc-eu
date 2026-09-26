/** Reproducible technical evidence export. This command does NOT verify external law. */
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {dajcEuropeCoverage} from '../config/europe-coverage.mjs';
import {canonicalDrivingBans, getDrivingBansSnapshot, drivingBanScope, drivingBanExcludedList} from '../config/driving-ban-calendars/runtime.mjs';
import {hydrateCanonical,diffCanonical,toIcs,assertSweepRequest,BAN_STATES,VERIFICATION_STATES} from '../src/lib/driving-bans/core.mjs';
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;assert(args[i+1]&&!args[i+1].startsWith('--'),`Missing value: ${name}`);return args[i+1];};
const clock=new Date(option('--clock',new Date().toISOString()));
assert(Number.isFinite(clock.getTime()),'Invalid audit clock');
const view=getDrivingBansSnapshot(clock);
const mode=option('--mode','validate');
const selected=mode==='validate'?view.jurisdictions.map(j=>j.jurisdiction):assertSweepRequest({mode,jurisdiction:option('--jurisdiction',undefined),urgentSource:option('--urgent-source',undefined),publishedBanId:option('--published-ban-id',undefined)},canonicalDrivingBans,clock);
const out=resolve(option('--output','artifacts/driving-bans'));mkdirSync(out,{recursive:true});
const count=key=>Object.fromEntries((key==='ban_state'?BAN_STATES:VERIFICATION_STATES).map(v=>[v,view.jurisdictions.filter(j=>j[key]===v).length]));
const raw=readFileSync(new URL('../data/driving-bans/canonical.json',import.meta.url));
const previous=option('--previous',null);
// Older datasets may still carry reviews for identities now excluded from the Driving Bans scope.
const inScope=data=>({...data,jurisdiction_reviews:Object.fromEntries(Object.entries(data.jurisdiction_reviews||{}).filter(([code])=>drivingBanScope.some(([c])=>c===code)))});
const delta=previous?diffCanonical(hydrateCanonical(inScope(JSON.parse(readFileSync(previous,'utf8'))),drivingBanScope),canonicalDrivingBans):[];
const lastSweep=view.jurisdictions.map(j=>j.last_checked).filter(Boolean).sort().at(-1)||null;
const sweepAgeDays=lastSweep?(clock.getTime()-Date.parse(lastSweep))/86400000:Infinity;
const byState=state=>view.jurisdictions.filter(j=>j.ban_state===state).map(j=>j.jurisdiction);
const summary={dataset_version:view.dataset_version,reviewed_span:canonicalDrivingBans.window,active_window_reviewed:!view.jurisdictions.some(j=>j.coverage_failures.includes('ACTIVE_WINDOW_NOT_REVERIFIED')),last_sweep:lastSweep,sweep_age_days:Number.isFinite(sweepAgeDays)?Math.round(sweepAgeDays*10)/10:null,fully_verified_jurisdictions:view.jurisdictions.filter(j=>j.coverage_complete).map(j=>j.jurisdiction),has_ban:byState('HAS_BAN'),no_ban:byState('NO_BAN'),unknown:byState('UNKNOWN'),generated_at:view.generated_at,window:view.window,coverage_total:dajcEuropeCoverage.length,tracked:view.jurisdictions.length,excluded_from_scope:drivingBanExcludedList,verification_state:count('verification_state'),ban_state:count('ban_state'),fully_verified:view.jurisdictions.filter(j=>j.coverage_complete).length,individual_primary_rules:canonicalDrivingBans.rules.filter(r=>r.verification_state==='PRIMARY_VERIFIED'&&r.status==='ACTIVE').length,whole_window_events:view.events.length,upcoming_events:view.upcoming_events.length,complete:view.complete,canonical_sha256:createHash('sha256').update(raw).digest('hex'),mode,selected_jurisdictions:selected,external_source_review_performed:false,note:'Technical validation is not a semantic legal verification or a successful full sweep of the Driving Bans scope.',changes:delta};
const save=(file,value)=>writeFileSync(join(out,file),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
save('summary.json',summary);save('coverage.json',view.jurisdictions);save('snapshot.json',view);save('driving-bans.ics',toIcs(view));save('driving-bans-history.ics',toIcs(view,{upcoming:false}));
const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const headers=['jurisdiction','name','from','to','verification_state','ban_state','last_checked','last_verified','coverage_complete','event_count','source_urls','coverage_failures'];
const rows=view.jurisdictions.map(j=>[j.jurisdiction,j.name,j.period.from,j.period.to,j.verification_state,j.ban_state,j.last_checked,j.last_verified,j.coverage_complete,j.event_count,j.source_ids.map(id=>view.sources.find(s=>s.source_id===id)?.url).filter(Boolean).join(' | '),j.coverage_failures.join(' | ')]);
save('coverage.csv','\uFEFF'+[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n');
console.log(JSON.stringify(summary,null,2));
if(args.includes('--require-complete')&&!view.complete)process.exitCode=2;
// Thursday gate: the reviewed span must contain the active window and the last sweep must be recent.
const maxAge=option('--max-sweep-age-days',null);
if(maxAge!==null&&(!summary.active_window_reviewed||!(sweepAgeDays<=Number(maxAge)))){console.error(`Driving Bans sweep is stale: active_window_reviewed=${summary.active_window_reviewed}, sweep_age_days=${summary.sweep_age_days}, limit=${maxAge}`);process.exitCode=3;}
