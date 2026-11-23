import type { APIRoute } from 'astro';
import { db, hashToken, tokenValid } from '../../../lib/integrations/core';
import { renderIntegrationPdf } from '../../../lib/integrations/pdf';
export const prerender=false;

const deny=(status:number)=>new Response('Document link is invalid or expired.',{
  status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex,nofollow,noarchive'}
});
export const GET:APIRoute=async ({request})=>{
  const t=new URL(request.url).searchParams.get('t')||'';
  if(!tokenValid(t))return deny(404);
  try{
    const sql=db();
    const matches=await sql`
      UPDATE integration_docs.requests SET download_count=download_count+1
      WHERE download_token_hash=${hashToken(t)} AND verified_at IS NOT NULL
        AND download_expires_at>now()
      RETURNING product`;
    if(!matches.length)return deny(410);
    const product=matches[0].product;
    if(product!=='platform'&&product!=='tar')return deny(404);
    const bytes=renderIntegrationPdf(product);
    const filename=product==='platform'?
      'DAJC-Platform-Integration-Architecture.pdf':'DAJC-TAR-Integration-Architecture.pdf';
    return new Response(new Uint8Array(bytes),{
      status:200,
      headers:{
        'Content-Type':'application/pdf',
        'Content-Disposition':'attachment; filename="'+filename+'"',
        'Content-Length':String(bytes.byteLength),
        'Cache-Control':'private, no-store, max-age=0',
        'Referrer-Policy':'no-referrer',
        'X-Robots-Tag':'noindex,nofollow,noarchive',
        'X-Content-Type-Options':'nosniff',
      },
    });
  }catch{
    console.error('DAJC integration document delivery failed');
    return deny(503);
  }
};
