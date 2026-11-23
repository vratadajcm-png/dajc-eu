import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import {
  AREAS, RateLimitError, allowedOrigin, cleanup, configReady, db, emailValid,
  hashToken, limit, publicUrl, response, sendEmail, tidy, token,
} from '../../../lib/integrations/core';
export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!allowedOrigin(request)) return response(403,{ok:false,error:'Origin not allowed.'});
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return response(415,{ok:false,error:'Expected JSON.'});
  }
  if (!configReady()) {
    return response(503,{ok:false,error:'Document requests are not available yet. Please contact team@dajc.eu.'});
  }
  let payload:Record<string,unknown>;
  try {
    const raw=await request.text();
    if(raw.length>6000)return response(413,{ok:false,error:'Submission too large.'});
    const parsed:unknown=JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed!=='object') throw new Error();
    payload=parsed as Record<string,unknown>;
  } catch {return response(400,{ok:false,error:'Invalid form.'});}
  // Deliberately do not store submissions from obvious automated bots.
  if(tidy(payload.website,150))return response(200,{ok:true});
  const product=tidy(payload.product,20);
  const company=tidy(payload.company,160);
  const email=tidy(payload.email,254).toLowerCase();
  const integrationArea=tidy(payload.integrationArea,50);
  if((product!=='platform'&&product!=='tar') || company.length<2 ||
    !emailValid(email) || !AREAS.includes(integrationArea as typeof AREAS[number]) ||
    payload.privacyAcknowledged!==true){
    return response(400,{ok:false,error:'Please check the required fields and privacy acknowledgement.'});
  }
  const verificationToken=token();
  const id=randomUUID();
  try{
    const sql=db();
    await sql.begin(async tx=>{
      await limit(tx,clientAddress||'unknown');
      await tx`
        INSERT INTO integration_docs.requests
        (id,product,company,email,integration_area,verification_token_hash,verification_expires_at)
        VALUES (${id}::uuid,${product},${company},${email},${integrationArea},
                ${hashToken(verificationToken)}, now()+interval '24 hours')`;
    });
    const link=publicUrl('/integrations/confirm?t='+verificationToken,request);
    try{
      await sendEmail(email,'Confirm your DAJC '+product.toUpperCase()+' technical documentation request',
        'Hello,\n\nYou requested the DAJC '+product.toUpperCase()+' integration architecture overview for '+company+'.\n\n'
        +'Confirm the email address using this link (valid for 24 hours):\n'+link+'\n\n'
        +'After confirmation we will email you a time-limited download link for the PDF.\n'
        +'If you did not request this document, ignore this email. You will not be subscribed to marketing.\n\n'
        +'DAJC | https://www.dajc.eu\nteam@dajc.eu');
    }catch{
      // An unsent confirmation must not create a misleading pending lead.
      await sql`DELETE FROM integration_docs.requests WHERE id=${id}::uuid`;
      return response(503,{ok:false,error:'Verification email could not be delivered. Please try later.'});
    }
    await sql`UPDATE integration_docs.requests SET verification_email_sent_at=now() WHERE id=${id}::uuid`;
    await cleanup();
    return response(200,{ok:true,message:'Check your inbox for the verification email.'});
  } catch(e){
    if(e instanceof RateLimitError)return response(429,{ok:false,error:'Too many requests. Please try later.'});
    console.error('DAJC integration document request failed');
    return response(503,{ok:false,error:'Unable to process the request at this time.'});
  }
};
