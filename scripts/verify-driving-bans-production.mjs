/** Read-only HTTP acceptance. No external-law review, login, or production write. */
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getDrivingBansSnapshot} from '../config/driving-ban-calendars/runtime.mjs';
const origin = 'https://www.dajc.eu';
const out = 'artifacts/driving-bans-production';
mkdirSync(out, {recursive:true});
const report = {checked_at:new Date().toISOString(), origin, checks:[], responses:[], errors:[], legal_review_complete:false};
const save = (name, value) => writeFileSync(`${out}/${name}`, typeof value === 'string' ? value : JSON.stringify(value,null,2)+'\n');
async function read(path, name) {
  const response = await fetch(new URL(path, origin), {signal:AbortSignal.timeout(30000), headers:{'Accept':'*/*','Cache-Control':'no-cache','User-Agent':'DAJC-Driving-Bans-Acceptance/1.0'}});
  const body = await response.text();
  const metadata = {path, url:response.url, status:response.status, bytes:Buffer.byteLength(body), content_type:response.headers.get('content-type'), cache_control:response.headers.get('cache-control'), server_date:response.headers.get('date'), sha256:createHash('sha256').update(body).digest('hex')};
  report.responses.push(metadata); save(name,body);
  assert(['dajc.eu','www.dajc.eu'].includes(new URL(response.url).hostname), 'Unexpected redirect host');
  assert.equal(response.status,200,`${path} HTTP status`);
  return {body,metadata};
}
async function check(name, fn) {
  try {const observed = await fn(); report.checks.push({name,status:'PASS',observed});}
  catch(error) {const message=error instanceof Error ? error.message : String(error);report.checks.push({name,status:'FAIL',error:message});report.errors.push(`${name}: ${message}`);}
}
const ordered = values => [...values].sort();
const icsStamp = value => value.replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/,'Z');
function parseIcs(body) {
  assert(body.startsWith('BEGIN:VCALENDAR\r\n') && body.endsWith('END:VCALENDAR\r\n'), 'ICS envelope or CRLF');
  assert(body.split('\r\n').every(line=>Buffer.byteLength(line)<=75),'ICS line length');
  const plain = body.replace(/\r\n[ \t]/g,'');
  const blocks = [...plain.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)];
  const events = blocks.map(match=>Object.fromEntries(match[1].split('\r\n').filter(Boolean).map(line=>{const pos=line.indexOf(':');return [line.slice(0,pos),line.slice(pos+1)];})));
  assert.equal(new Set(events.map(e=>e.UID)).size,events.length,'Duplicate UID');
  assert(!plain.includes('UID:coverage-warning') && !plain.includes('SUMMARY:NO_BAN') && !plain.includes('DTSTART;VALUE=DATE'),'Pseudo/all-day event');
  return {events,plain};
}
let live, expected;
await check('public JSON vs canonical snapshot',async()=>{
  const {body,metadata}=await read('/api/driving-bans.json','live-snapshot.json');live=JSON.parse(body);
  assert(Number.isFinite(Date.parse(live.generated_at)),'Invalid generated_at');
  assert(Math.abs(Date.now()-Date.parse(live.generated_at))<180000,'Stale generated_at / cached window');
  expected=getDrivingBansSnapshot(new Date(live.generated_at));
  assert.equal(live.dataset_version,expected.dataset_version);assert.deepEqual(live.window,expected.window);
  assert.equal(live.jurisdictions.length,104);assert.equal(new Set(live.jurisdictions.map(j=>j.jurisdiction)).size,104);
  assert.deepEqual(live.jurisdictions.map(j=>[j.jurisdiction,j.ban_state,j.verification_state,j.coverage_complete]),expected.jurisdictions.map(j=>[j.jurisdiction,j.ban_state,j.verification_state,j.coverage_complete]));
  const projection = es => es.map(e=>[e.uid,e.starts_at,e.ends_at,e.jurisdiction,JSON.stringify(e.weight_threshold)]);
  assert.deepEqual(projection(live.events),projection(expected.events));assert.deepEqual(projection(live.upcoming_events),projection(expected.upcoming_events));assert.equal(live.complete,expected.complete);
  assert.match(metadata.cache_control||'',/no-store/);
  return {version:live.dataset_version,window:live.window,jurisdictions:104,whole_window_events:live.events.length,upcoming_events:live.upcoming_events.length,complete:live.complete,states:Object.fromEntries(['HAS_BAN','NO_BAN','UNKNOWN'].map(s=>[s,live.jurisdictions.filter(j=>j.ban_state===s).length]))};
});
await check('production web identity/state/title consistency',async()=>{
  const {body,metadata}=await read('/driving-bans?lang=cs','live-page.html');assert(live && expected,'JSON prerequisite failed');
  const title=body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'';assert.match(title,/DAJC|zákazy/i);assert(!/Cohere|Member of Technical Staff/i.test(title),'Unrelated page title');
  const tags=[...body.matchAll(/<details\b[^>]*\bclass="jurisdiction"[^>]*>/g)].map(m=>m[0]);
  const attrs=tags.map(t=>Object.fromEntries([...t.matchAll(/(data-[\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]])));
  assert.equal(attrs.length,104);assert.deepEqual(ordered(attrs.map(a=>a['data-code'])),ordered(live.jurisdictions.map(j=>j.jurisdiction)));
  for(const a of attrs){const j=live.jurisdictions.find(j=>j.jurisdiction===a['data-code']);assert.equal(a['data-ban-state'],j.ban_state);assert.equal(a['data-verification-state'],j.verification_state);}
  assert(body.includes(live.window.from)&&body.includes(live.window.to)&&body.includes(live.dataset_version));assert(body.includes('104 sledovaných jurisdikcí neznamená 104 ověřených jurisdikcí.'));
  assert.match(metadata.cache_control||'',/no-store/);return {title,jurisdictions:attrs.length};
});
for(const history of [false,true]) await check(history?'history ICS vs whole-window JSON':'default ICS vs upcoming JSON',async()=>{
  const {body,metadata}=await read(`/api/driving-bans.ics${history?'?history=1':''}`,history?'live-history.ics':'live-upcoming.ics');assert(live && expected,'JSON prerequisite failed');
  const {events,plain}=parseIcs(body), wanted=history?live.events:live.upcoming_events;
  assert.deepEqual(ordered(events.map(e=>e.UID)),ordered(wanted.map(e=>e.uid)));
  for(const e of events){const target=wanted.find(t=>t.uid===e.UID);assert.equal(e.DTSTART,icsStamp(target.starts_at));assert.equal(e.DTEND,icsStamp(target.ends_at));assert.equal(e['X-DAJC-TIMEZONE'],target.timezone);assert.equal(e.STATUS,'CONFIRMED');}
  if(!history)assert(wanted.every(e=>e.ends_at>live.generated_at),'Expired default event');
  assert(plain.includes(`X-DAJC-WINDOW:${live.window.from}/${live.window.to}`));assert.match(metadata.cache_control||'',/no-store/);
  return {events:events.length,uid_and_utc_time_match:true,duplicates:0,no_pseudo_events:true};
});
await check('unknown jurisdiction has no fake ICS events',async()=>{
  assert(live,'JSON prerequisite failed');const unknown=live.jurisdictions.find(j=>j.ban_state==='UNKNOWN');if(!unknown)return {not_applicable:true};
  const {body}=await read(`/api/driving-bans.ics?countries=${encodeURIComponent(unknown.jurisdiction)}`,'live-unknown.ics');const {events,plain}=parseIcs(body);assert.equal(events.length,0);assert(plain.includes('X-DAJC-COVERAGE-COMPLETE:FALSE'));return {jurisdiction:unknown.jurisdiction,events:0};
});
for(const path of ['/','/news']) await check(`unrelated page smoke ${path}`,async()=>{const {body}=await read(path,path==='/'?'live-home.html':'live-news.html');const title=body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'';assert.match(title,/DAJC/i);assert(!/Cohere|Member of Technical Staff/i.test(title));return {title};});
report.status=report.errors.length?'FAIL':'PASS';save('acceptance.json',report);console.log(JSON.stringify(report,null,2));
if(report.errors.length)process.exitCode=1;
