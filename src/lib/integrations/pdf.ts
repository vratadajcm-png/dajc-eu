import type { IntegrationProduct } from './core';

type Group = { heading: string; lines: string[] };
type Page = { kicker: string; title: string; intro: string; diagram?: string[]; groups: Group[] };

const themes: Record<IntegrationProduct,{label:string;subtitle:string;identity:string;pages:Page[]}> = {
  platform: {
    label:'DAJC PLATFORM',
    subtitle:'Heavy & Oversized Transport Coordination',
    identity:'One D-ID connects authorised participants while existing systems remain in place.',
    pages:[
      {kicker:'01 / ARCHITECTURE',title:'A provider-neutral coordination layer',
        intro:'The target architecture connects specialist systems through defined interfaces. It is not another compulsory TMS or a replacement for existing provider tools.',
        diagram:['TMS / ERP','DAJC D-ID','Permits / Routes'],
        groups:[
          {heading:'Core principle',lines:['The originating TMS or specialist system retains its own records and identifier.','DAJC maintains a permissioned operational context and links relevant events to a transport D-ID.','External records are referenced, not silently overwritten or assumed to be legally authoritative.']},
          {heading:'Integration boundary',lines:['Adapters map source fields to a stable DAJC event and document model.','System access, data scope and write-back permissions are agreed per organisation.','No third-party API connection is implied merely by inclusion in this architecture.']}]},
      {kicker:'02 / DATA MODEL',title:'Identity, ownership and provenance',
        intro:'A D-ID is a shared reference for one transport process, not a new legal document or a replacement for the source systems that originate data.',
        groups:[
          {heading:'Typical information objects',lines:['Transport identity, customer reference, cargo geometry and loading or delivery milestones.','Vehicle composition, route constraints, permits, approved instructions and responsible parties.','Document references, revisions, authorisations, status changes and delivery evidence.']},
          {heading:'Preserving the system of record',lines:['The source authority for each field is recorded: TMS, operator, permit holder or official authority.','Only approved changes are propagated. Conflicts require a defined reconciliation rule.','Sensitive customer data is minimised and scoped to an authorised tenant and user role.']}]},
      {kicker:'03 / TRANSPORT SCENARIO',title:'One transport, many participants',
        intro:'Illustrative oversized-transport workflow: a delivery schedule changes after the original permit and route documents have been circulated.',
        diagram:['Order','D-ID','Approved plan'],
        groups:[
          {heading:'Sequence of events',lines:['An order is created in the existing TMS and associated with the DAJC D-ID.','Approved cargo, route and permit data are linked with provenance and validity.','A revised loading time becomes a versioned event with affected participants.']},
          {heading:'The intended result',lines:['Dispatcher, driver and authorised specialists see a consistent current context.','Documents and confirmations retain an audit trail; earlier versions are not silently discarded.','Operational decisions remain with qualified staff and responsible authorities.']}]},
      {kicker:'04 / CONNECTIVITY',title:'Methods of integration',
        intro:'DAJC is designed to connect heterogeneous enterprise and transport systems. Available methods depend on the capabilities and authorisation of the specific source.',
        groups:[
          {heading:'Interface patterns',lines:['REST APIs for structured request and response exchange where permitted.','Webhooks and event queues for transport status, blockers, document changes and acknowledgements.','EDI, managed SFTP and document ingestion for legacy or file-oriented workflows.']},
          {heading:'Adapters and mapping',lines:['Provider adapters isolate vendor-specific formats from the common DAJC domain model.','Mappings include external identifiers, timestamps, units, event types and error states.','Read-only integration is preferred when write-back permissions or legal responsibility are unclear.']}]},
      {kicker:'05 / SECURITY',title:'Permissioned exchange by design',
        intro:'Interoperability must preserve organisational boundaries, legal responsibilities and control over confidential transport information.',
        groups:[
          {heading:'Security principles',lines:['Tenant isolation and role-based access control define who may access each D-ID.','Credentials and third-party API secrets remain server-side, scoped and rotatable.','Transport documents and events require encrypted transit and auditable processing.']},
          {heading:'Authority and verification',lines:['Official permits and statutory restrictions must be verified against current authority sources.','Historical matching does not itself authorise automatic permit issuance.','An approved external integration does not imply certification or endorsement of DAJC.']}]},
      {kicker:'06 / RESILIENCE',title:'Reliable coordination under change',
        intro:'Transport processes continue despite intermittent connectivity, provider outages and mismatched versions.',
        groups:[
          {heading:'Failure handling',lines:['Retries use idempotent event identifiers to avoid duplicate state changes.','Unknown or missing external data is labelled as such rather than treated as an all-clear.','Failed delivery, partial updates and stale documents are surfaced for reconciliation.']},
          {heading:'Operational continuity',lines:['Offline driver documentation has an explicit validity and synchronisation policy.','Dispatch retains responsibility for exceptions, approvals and handovers.','Source systems remain usable when the DAJC coordination layer is unavailable.']}]},
      {kicker:'07 / PARTNER CONVERSATION',title:'What a technical discovery covers',
        intro:'A practical conversation starts from the partner system and the value of data exchange, not a requirement to replace existing software.',
        groups:[
          {heading:'Technical discovery topics',lines:['Which business objects can be read, and which may be updated with explicit permission?','What identifiers, units, timezones, revision rules and event semantics are used?','What authentication, rate limits, service levels and audit requirements apply?']},
          {heading:'Next steps',lines:['Agree a bounded use case and responsibility matrix before implementation.','Validate field mappings and failure cases with synthetic, non-sensitive data.','Review privacy, security, commercial rights and official-source obligations separately.']}]},
    ],
  },
  tar:{
    label:'DAJC TAR',
    subtitle:'Tow, Assistance & Recovery',
    identity:'One Recovery Passport connects the incident, mixed fleet, field evidence and settlement.',
    pages:[
      {kicker:'01 / ARCHITECTURE',title:'One workspace for one provider',
        intro:'The target model treats towing, assistance, heavy recovery and mobile service as capabilities of one service-provider organisation.',
        diagram:['Incident','Recovery Passport','Dispatch'],
        groups:[
          {heading:'Operational core',lines:['Each incoming job is linked to one Recovery Passport and its originating reference.','Qualified crews, tow vehicles, recovery equipment and service vans share a dispatch model.','Partner updates, technical evidence, handovers and billing use the same case context.']},
          {heading:'Integration boundary',lines:['Provider adapters isolate external job and event formats from the DAJC case model.','External insurers, assistance networks and dispatch systems retain their source records.','Publication of this architecture does not imply a commercial integration is already operational.']}]},
      {kicker:'02 / DATA MODEL',title:'The Recovery Passport',
        intro:'The Recovery Passport links relevant incident information while preserving each partner, provider and case-owner responsibility.',
        groups:[
          {heading:'Typical case objects',lines:['Originating request, incident place, vehicle attributes, symptoms and contact permissions.','Dispatched crew, equipment, safety assessment, milestones and service actions.','Images, signatures, custody handovers, authorisations, costs and completion report.']},
          {heading:'Ownership and data minimisation',lines:['Insurer or assistance case identifiers remain linked to the original provider.','Data is shared only with authorised roles for the specific job and declared purpose.','Sensitive motorist and incident information is retained according to agreed policies.']}]},
      {kicker:'03 / RECOVERY SCENARIO',title:'One incident through completion',
        intro:'Illustrative heavy-truck recovery: a call-out requires a specialist crew, a tow truck and an additional mobile repair unit.',
        diagram:['Request','Dispatch','Recovery'],
        groups:[
          {heading:'Sequence of events',lines:['A job is accepted from an authorised phone, portal or interface intake.','Dispatch assigns qualified people, vehicle types and equipment to one case.','Field staff record work, safety decisions, photos and partner confirmations.']},
          {heading:'The intended result',lines:['Partners can receive the authorised milestones and completion evidence they need.','Additional tasks and costs are recorded with approval and provenance.','A single documented case supports handover and downstream invoicing.']}]},
      {kicker:'04 / CONNECTIVITY',title:'Methods of integration',
        intro:'The architecture covers different classes of case sources, dispatch tools, vehicle data and accounting systems without naming prospective counterparties.',
        groups:[
          {heading:'Interface patterns',lines:['REST APIs and webhooks where authorised partner systems support structured exchange.','EDI, managed file exchange or secure document imports for alternative channels.','Mobile and rugged-device interfaces for authorised field technicians.']},
          {heading:'Adapter responsibilities',lines:['Translate partner case identifiers, event codes and message semantics.','Handle assignment, acknowledgement, changes, completion and approved cost lines.','Avoid changing or inferring an insurer coverage or entitlement decision.']}]},
      {kicker:'05 / SAFETY',title:'Qualified human decisions remain central',
        intro:'Digital tools can support documentation and calculations but never replace competent on-scene judgment or legally required procedures.',
        groups:[
          {heading:'Field controls',lines:['Recovery assessment, stability and rigging calculations are aids subject to qualified verification.','Vehicle diagnostics or OEM guidance may inform work but are not automatic repair approvals.','Evidence capture should support offline use with documented synchronisation and provenance.']},
          {heading:'Geospatial and traffic data',lines:['Traffic restrictions, weather events and positioning are context, not unconditional clearance.','Official sources and local scene conditions take precedence over model recommendations.','A case record must distinguish measurements, observations and inferred information.']}]},
      {kicker:'06 / SECURITY',title:'Secure cross-organisation handoffs',
        intro:'A tow or recovery incident may involve a motorist, insurer, assistance desk, subcontractor, police, fleet manager and workshop.',
        groups:[
          {heading:'Access design',lines:['Case-scoped permissions limit access to relevant personal and operational information.','API credentials are segregated, monitored and rotatable for each organisation.','All material approvals, handovers and data exports require an audit record.']},
          {heading:'Operational reliability',lines:['Duplicate incident messages and delayed partner acknowledgements are reconciled.','Offline data is clearly marked until synchronised and confirmed.','Dispatch can continue locally if an external provider or API is unavailable.']}]},
      {kicker:'07 / PARTNER CONVERSATION',title:'Integration discovery and handoff',
        intro:'A successful integration begins with defined responsibilities, a narrow case-flow and a safe test dataset.',
        groups:[
          {heading:'Discovery questions',lines:['What partner case events can be supplied and what acknowledgements are required?','Who may approve charges, assignments, customer notifications and recovery completion?','What evidence, retention, privacy and accounting handoffs are mandatory?']},
          {heading:'Next steps',lines:['Map the case lifecycle and define a unique incident-to-provider reference scheme.','Verify consent, access roles, data quality, recovery safety and financial controls.','Validate test flows with synthetic incidents before any real operational use.']}]},
    ],
  },
};

const W=595, H=842;
const color={ navy:'0.024 0.102 0.200', orange:'1.000 0.624 0.000',
  blue:'0.055 0.180 0.310', pale:'0.949 0.968 0.985', ink:'0.075 0.155 0.245',
  gray:'0.350 0.425 0.510', white:'1 1 1', border:'0.77 0.82 0.88' };
function ascii(value:string):string {
  return value.normalize('NFKD').replace(/[^\x20-\x7E]/g, s => {
    return ({'–':'-','—':'-','→':'>','•':'-','’':"'",'“':'"','”':'"'} as Record<string,string>)[s]||' ';
  });
}
function quote(value:string):string {
  return ascii(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}
function box(c:string[],x:number,y:number,w:number,h:number,fill:string) {
  c.push(fill+' rg '+x+' '+y+' '+w+' '+h+' re f');
}
function stroke(c:string[],x1:number,y1:number,x2:number,y2:number,colour:string,width=1){
  c.push(colour+' RG '+width+' w '+x1+' '+y1+' m '+x2+' '+y2+' l S');
}
function txt(c:string[],x:number,y:number,text:string,size:number,colour:string,bold=false) {
  c.push(colour+' rg BT /'+(bold?'F2':'F1')+' '+size+' Tf 1 0 0 1 '+x+' '+y+' Tm ('+quote(text)+') Tj ET');
}
function wrap(text:string,maxChars:number):string[] {
  const words=ascii(text).split(/\s+/).filter(Boolean);const lines:string[]=[];let line='';
  for(const word of words) {
    if((line+' '+word).trim().length>maxChars&&line){lines.push(line);line=word;}
    else line=(line+' '+word).trim();
  }
  if(line)lines.push(line);
  return lines;
}
function wrapped(c:string[],x:number,y:number,value:string,size:number,colour:string,maxChars:number,leading:number,bold=false):number{
  for(const line of wrap(value,maxChars)){txt(c,x,y,line,size,colour,bold);y-=leading;}
  return y;
}
function cover(product:IntegrationProduct):string {
  const d=themes[product],c:string[]=[];
  box(c,0,0,W,H,color.navy);
  box(c,0,0,W,14,color.orange);
  box(c,52,713,90,5,color.orange);
  txt(c,52,749,'DAJC / TECHNICAL ARCHITECTURE',11,color.white,true);
  txt(c,52,643,d.label,36,color.white,true);
  let y=594;
  y=wrapped(c,52,y,d.subtitle,19,color.orange,38,28,true);
  stroke(c,52,543,543,543,color.border,0.6);
  y=500;y=wrapped(c,52,y,d.identity,16,color.white,54,25);
  box(c,52,320,490,100,color.blue);
  txt(c,72,387,'WHY THIS DOCUMENT EXISTS',10,color.orange,true);
  y=361;
  y=wrapped(c,72,y,'A provider-neutral explanation of the proposed integration model, data responsibilities, operational workflows and technical discovery requirements.',11,color.white,66,17);
  txt(c,52,205,'DOCUMENT SCOPE',10,color.orange,true);
  wrapped(c,52,178,'Conceptual architecture for technical evaluation. This PDF is not an API contract, supplier commitment, certification or proof of production availability.',10,color.white,75,17);
  txt(c,52,95,'DAJC.EU  /  NOVEMBER 2026  /  VERSION 1.0',9,color.white);
  txt(c,52,60,'CONFIDENTIALITY: INFORMATIONAL TECHNICAL BRIEF',8,color.border);
  return c.join('\n');
}
function inside(product:IntegrationProduct,page:Page,index:number):string {
 const d=themes[product],c:string[]=[];
 box(c,0,0,W,H,color.pale);box(c,0,H-82,W,82,color.navy);
 box(c,43,H-92,90,5,color.orange);
 txt(c,44,H-42,'DAJC  /  '+d.label,12,color.white,true);
 txt(c,44,H-62,ascii(d.subtitle).toUpperCase(),8.7,color.border);
 txt(c,44,704,page.kicker,10,color.orange,true);
 txt(c,44,667,page.title,21,color.ink,true);
 let y=633;
 y=wrapped(c,44,y,page.intro,11,color.gray,91,17);
 y-=24;
 if(page.diagram){
   const pad=44,gap=12,width=(W-2*pad-2*gap)/3;
   for(let k=0;k<3;k++){
     const x=pad+k*(width+gap);
     box(c,x,y-57,width,60,k===1?color.blue:color.navy);
     txt(c,x+12,y-33,page.diagram[k],10.5,k===1?color.white:color.white,true);
     if(k<2)txt(c,x+width+2,y-34,'>',11,color.orange,true);
   }
   y-=83;
 }
 for(const group of page.groups){
   box(c,44,y-3,3,17,color.orange);
   txt(c,58,y,group.heading,13.4,color.ink,true);
   y-=28;
   for(const item of group.lines){
     box(c,52,y+4,3,3,color.orange);
     const ys=wrapped(c,64,y,item,10.1,color.ink,82,15);
     y=ys-11;
   }
   y-=11;
 }
 stroke(c,44,66,W-44,66,color.border,.7);
 txt(c,44,49,'DAJC / Integration Architecture / Concept only',8.4,color.gray);
 txt(c,484,49,'PAGE '+String(index+1)+' / 8',8.4,color.gray,true);
 return c.join('\n');
}
export function renderIntegrationPdf(product:IntegrationProduct):Uint8Array{
 const d=themes[product];
 const pages=[cover(product),...d.pages.map((p,i)=>inside(product,p,i+1))];
 const objects:string[]=[];
 const add=(item:string):number=>{objects.push(item);return objects.length;};
 const f1=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 const f2=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
 const pagesObj=add('');
 const pageIds:number[]=[];
 for(const stream of pages){
   const content=add('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');
   const page=add('<< /Type /Page /Parent '+pagesObj+' 0 R /MediaBox [0 0 '+W+' '+H+'] /Resources << /Font << /F1 '+f1+' 0 R /F2 '+f2+' 0 R >> >> /Contents '+content+' 0 R >>');
   pageIds.push(page);
 }
 objects[pagesObj-1]='<< /Type /Pages /Kids [ '+pageIds.map(x=>x+' 0 R').join(' ')+' ] /Count '+pageIds.length+' >>';
 const catalog=add('<< /Type /Catalog /Pages '+pagesObj+' 0 R >>');
 const info=add('<< /Title (DAJC '+d.label+' Integration Architecture) /Author (DAJC) /Subject (Conceptual technical architecture) >>');
 let pdf='%PDF-1.4\n';const offsets=[0];
 for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
 const xref=pdf.length;
 pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
 for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
 pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root '+catalog+' 0 R /Info '+info+' 0 R >>\nstartxref\n'+xref+'\n%%EOF';
 return new TextEncoder().encode(pdf);
}
