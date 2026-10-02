// Deterministic DAJC Weekly substance/freshness gate.
const DAY_MS = 24 * 60 * 60 * 1000;

const DIRECT_OVERSIZE_SIGNAL =
  /exceptional transport|exceptional vehicle|oversize|oversized|abnormal load|wide load|heavy transport|special transport|ausnahmetransport|schwertransport|gro[ßs]raum|convoi exceptionnel|transport exceptionnel|trasporto eccezionale|transporte especial|izvanredni prijevoz|agabaritic|nadrozm[eě]rn|nadmerný|pilot vehicle|escort vehicle|private escort|police escort|begleitfahrzeug|route permit|special permit|overweight permit|overdimension/i;

const CHANGE_SIGNAL =
  /new|changed|change|updated|update|introduced|effective|enters? into force|starts?|begins?|launch|restriction|limit|closure|closed|permit|escort|authori[sz]ation|bewilligung|genehmigung|verordnung|regel|nov[ýáé]|změn|zmena|ograni[cč]|zabrana/i;

const GENERIC_NOISE = [
  /(?:cancelled|canceled|postponed|delayed|ausfall).{0,80}(?:heavy transport|schwertransport|exceptional transport|oversize)/i,
  /(?:heavy transport|schwertransport|exceptional transport|oversize).{0,80}(?:cancelled|canceled|postponed|delayed|ausfall)/i,
  /battery[- ]?(?:powered|electric).{0,60}(?:loader|wheel loader|hjullaster)|(?:loader|wheel loader|hjullaster).{0,60}battery/i,
  /pedestrian.{0,50}(?:tunnel|bridge|path)|cycl(?:e|ing).{0,50}(?:path|tunnel|bridge)|jalg- ja jalgrattatee/i,
  /safety at (?:street|road) works.{0,80}(?:code|consultation)|street works and road works code of practice/i,
  /^(?:current )?roadworks?\b|traffic information centre.{0,80}current roadworks/i,
  /(?:price list|pricing|cjenovnik).{0,80}(?:tunnel|road|toll)|(?:tunnel|road|toll).{0,80}(?:price list|pricing|cjenovnik)/i,
  /bridge competence centre|brückenkompetenzzentrum|structural inspection schedule/i,
  /government conference|conférence de rentrée/i,
  /road information map|traffic & highways road information map/i,
];

const MONTHS = {
  january:0, jan:0, januar:0, janvier:0,
  february:1, feb:1, februar:1, février:1, fevrier:1,
  march:2, mar:2, märz:2, maerz:2, mars:2,
  april:3, apr:3, avril:3,
  may:4, mai:4,
  june:5, jun:5, juni:5, juin:5,
  july:6, jul:6, juli:6, juillet:6,
  august:7, aug:7, août:7, aout:7,
  september:8, sep:8, sept:8, septembre:8,
  october:9, oct:9, oktober:9, octobre:9,
  november:10, nov:10, novembre:10,
  december:11, dec:11, dezember:11, décembre:11, decembre:11,
};

function pushDate(out, y, m, d){
  const date=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
  if(!Number.isNaN(date.getTime()) && date.getUTCFullYear()===Number(y) && date.getUTCMonth()===Number(m)-1 && date.getUTCDate()===Number(d)) out.push(date);
}

export function extractExplicitDates(candidate={}){
  const text=[candidate.title,candidate.summary,candidate.whatChanged,candidate.timeWindow,candidate.sourceUrl].filter(Boolean).join(' ');
  const out=[];
  for(const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) pushDate(out,m[1],m[2],m[3]);
  for(const m of text.matchAll(/\b(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]\s*(20\d{2})\b/g)) pushDate(out,m[3],m[2],m[1]);
  const monthNames=Object.keys(MONTHS).sort((a,b)=>b.length-a.length).join('|');
  const re=new RegExp('\\b(\\d{1,2})[.\\s-]+('+monthNames+')[,\\s-]+(20\\d{2})\\b','gi');
  for(const m of text.matchAll(re)){
    const key=String(m[2]).toLowerCase();
    const month=MONTHS[key];
    if(month!==undefined) pushDate(out,m[3],month+1,m[1]);
  }
  return out;
}

function structuredOverlap(candidate,{weekStart,weekEnd}){
  const from=candidate.validFrom ? new Date(candidate.validFrom+'T00:00:00Z') : null;
  const to=candidate.validTo ? new Date(candidate.validTo+'T23:59:59Z') : null;
  if(!from && !to) return false;
  if(from && Number.isNaN(from.getTime())) return false;
  if(to && Number.isNaN(to.getTime())) return false;
  return (!to || to>=weekStart) && (!from || from<=weekEnd);
}

export function checkWeeklySubstance(candidate={}, {weekStart,weekEnd,discoveryWindowStart}={}){
  const text=[candidate.title,candidate.summary,candidate.whatChanged,candidate.location,candidate.routeScope,candidate.vehicleScope].filter(Boolean).join(' ');
  if(!text.trim()) return {ok:false,reason:'empty/generic source content has no weekly intelligence substance'};

  for(const pattern of GENERIC_NOISE){
    if(pattern.test(text)) return {ok:false,reason:'generic, one-off or non-oversize material is not DAJC Weekly intelligence'};
  }

  const directlyOversize=DIRECT_OVERSIZE_SIGNAL.test(text);
  const changeSignal=CHANGE_SIGNAL.test(text);

  if(candidate.type==='driving_ban' && (!directlyOversize || !changeSignal)){
    return {ok:false,reason:'ordinary Driving/Truck Ban belongs to the separate Driving Bans module'};
  }

  if(weekStart && weekEnd && structuredOverlap(candidate,{weekStart,weekEnd})) return {ok:true};

  const dates=extractExplicitDates(candidate);
  if(weekStart && weekEnd && dates.length){
    const freshStart=discoveryWindowStart instanceof Date
      ? new Date(discoveryWindowStart.getTime()-7*DAY_MS)
      : new Date(weekStart.getTime()-14*DAY_MS);
    const horizonEnd=new Date(weekEnd.getTime()+7*DAY_MS);
    const hasNearTargetDate=dates.some(d=>d>=freshStart && d<=horizonEnd);
    if(!hasNearTargetDate){
      return {ok:false,reason:'source dates are stale or outside the target-week intelligence window'};
    }
  }

  const infrastructureLike=/^(?:infrastructure|roadworks|road_closure|bridge_restriction|tunnel_restriction)$/i.test(candidate.type||'');
  if(infrastructureLike && !directlyOversize){
    const datesNearTarget = dates.length && weekStart && weekEnd &&
      dates.some(d=>d>=new Date(weekStart.getTime()-7*DAY_MS) && d<=new Date(weekEnd.getTime()+7*DAY_MS));
    if(!datesNearTarget){
      return {ok:false,reason:'generic infrastructure item lacks a current direct heavy/oversize consequence'};
    }
  }

  if(dates.length===0 && !candidate.validFrom && !candidate.validTo){
    if(candidate.status!=='new' && candidate.status!=='updated'){
      return {ok:false,reason:'undated standing/reference page is not a fresh weekly change'};
    }
    if(!changeSignal){
      return {ok:false,reason:'newly discovered page does not describe a concrete operational change'};
    }
  }

  return {ok:true};
}
