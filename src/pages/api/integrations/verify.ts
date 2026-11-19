import type { APIRoute } from 'astro';
import {
  allowedOrigin, configReady, db, hashToken, publicUrl,
  response, sendEmail, token, tokenValid,
} from '../../../lib/integrations/core';
export const prerender=false;

export const POST:APIRoute=async ({request})=>{
  if(!allowedOrigin(request))return response(403,{ok:false,error:'Origin not allowed.'});
  if(!request.headers.get('content-type')?.includes('application/json'))
    return response(415,{ok:false,error:'Expected JSON.'});
  if(!configReady())return response(503,{ok:false,error:'Email verification unavailable.'});
  let input:string;
  try{
    const raw=await request.text();
    if(raw.length>1000)return response(413,{ok:false,error:'Invalid verification request.'});
    const payload=JSON.parse(raw);
    input=String(payload?.token||'');
  }catch{return response(400,{ok:false,error:'Invalid verification request.'});}
  if(!tokenValid(input))return response(400,{ok:false,error:'Invalid or expired verification link.'});
  const accessToken=token();
  let result:readonly object[];
  try{
    const sql=db();
    result=await sql`
      UPDATE integration_docs.requests
      SET verified_at=now(), download_token_hash=${hashToken(accessToken)},
          download_expires_at=now()+interval '7 days'
      WHERE verification_token_hash=${hashToken(input)}
        AND verification_expires_at>now() AND verified_at IS NULL
      RETURNING id, product, company, email`;
    if(result.length===0)return response(410,{ok:false,error:'This link is expired or has already been used. Request a new one if needed.'});
  }catch{
    console.error('DAJC integration verification database error');
    return response(503,{ok:false,error:'Unable to verify your email at this time.'});
  }
  const row=result[0] as {id:string;product:string;company:string;email:string};
  const link=publicUrl('/api/integrations/download?t='+accessToken,request);
  let emailed=false;
  try{
    await sendEmail(row.email,'Your DAJC '+row.product.toUpperCase()+' integration architecture PDF',
      'Hello,\n\nYour email is verified. The DAJC '+row.product.toUpperCase()
      +' Integration Architecture PDF is available for download for 7 days:\n\n'
      +link+'\n\nThis document presents the intended technical architecture. '
      +'It does not guarantee the availability of a production integration or any commercial partnership.\n\n'
      +'If you did not request this document, you can ignore this message.\n'
      +'DAJC | https://www.dajc.eu\nteam@dajc.eu');
    emailed=true;
    await db()`UPDATE integration_docs.requests SET download_email_sent_at=now() WHERE id=${row.id}::uuid`;
  }catch{console.error('DAJC technical PDF link email not delivered');}
  return response(200,{
    ok:true,emailed,
    downloadUrl:link,
    message:emailed?'Your verified download link has been sent by email.':
      'Email delivery is unavailable; use your direct download link now.',
  });
};
