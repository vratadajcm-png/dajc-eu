import type { APIRoute } from 'astro';
import { db, response } from '../../../lib/integrations/core';
export const prerender=false;

// Invoked by Vercel Cron on the production deployment. Do not expose manually.
export const GET:APIRoute=async ({request})=>{
  const secret=process.env.CRON_SECRET;
  if(!secret || request.headers.get('authorization')!=='Bearer '+secret)
    return response(401,{ok:false});
  try{
    const sql=db();
    const res=await sql.begin(async tx=>{
      const expired=await tx`DELETE FROM integration_docs.requests
        WHERE created_at < now()-interval '12 months'
           OR (verified_at IS NULL AND created_at < now()-interval '30 days')
        RETURNING id`;
      const windows=await tx`DELETE FROM integration_docs.rate_limits
        WHERE window_start < now()-interval '48 hours'
        RETURNING visitor_hash`;
      return {expired:expired.length,windows:windows.length};
    });
    return response(200,{ok:true,...res});
  }catch{
    console.error('DAJC integration retention sweep failed');
    return response(503,{ok:false});
  }
};