import { createHash, createHmac, timingSafeEqual, randomBytes, scryptSync } from 'node:crypto';
import VoteCore from './vote-core.js';

const digest = x => createHash('sha256').update(x).digest();
const equal = (a,b) => timingSafeEqual(digest(a),digest(b));
const COOKIE = 'carnet-vote-session';
const MAX_BODY = 64000;
const json = (data,status=200,extra={}) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
export function handler({store,films,password=()=>process.env.CARNET_VOTE_PASSWORD,bootstrapHash=()=>'',clock=()=>Date.now(),secure=true}) {
  function sign(payload,secret) { return createHmac('sha256',secret).update('carnet-2027:'+payload).digest('base64url'); }
  function cookie(req,secret) {
    const value=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
    if(!value) return false;
    const [payload,sig]=value.split('.');
    if(!payload || !sig || !equal(sig,sign(payload,secret))) return false;
    try { const p=JSON.parse(Buffer.from(payload,'base64url').toString()); return p.exp>clock() && p.exp<clock()+13*3600000; } catch{return false;}
  }
  function setCookie(value,maxAge) { return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`; }
  async function readBody(req) {
    if(!req.headers.get('content-type')?.startsWith('application/json')) throw Error('Format de requête invalide.');
    if(Number(req.headers.get('content-length')||0)>MAX_BODY) throw Error('Requête trop volumineuse.');
    const reader=req.body?.getReader(); if(!reader) throw Error('Requête vide.');
    const chunks=[];let length=0;
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BODY){await reader.cancel();throw Error('Requête trop volumineuse.');}chunks.push(value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async function loginAttempt(db,ip,secret) {
    const bucket=Math.floor(clock()/900000),key='login/'+createHmac('sha256',secret).update(String(ip||'unknown')).digest('hex').slice(0,32);
    for(let i=0;i<4;i++) {
      const old=await db.getWithMetadata(key,{type:'json'}), count=old?.data.bucket===bucket?old.data.count:0;
      if(count>=12) return false;
      const result=await db.setJSON(key,{bucket,count:count+1},old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
      if(result.modified) return true;
    }
    return false;
  }
  return async (req,context={}) => {
    const url=new URL(req.url), action=url.searchParams.get('action');
    if(!['GET','POST'].includes(req.method)) return json({error:'Méthode non autorisée.'},405,{Allow:'GET, POST'});
    if(req.method==='POST' && req.headers.get('origin')!==url.origin) return json({error:'Origine de la requête refusée.'},403);
    try {
      const db=store();
      const envPassword=password(), auth=envPassword ? null : await db.get('auth',{type:'json'});
      if(req.method==='POST' && action==='setup') {
        if(envPassword || auth) return json({error:'Le vote collectif est déjà activé.'},409);
        const body=await readBody(req), expected=bootstrapHash();
        if(!expected || typeof body.token!=='string' || !equal(digest(body.token).toString('hex'),expected)) return json({error:'Activation refusée.'},403);
        if(typeof body.password!=='string' || body.password.length<16 || body.password.length>256) return json({error:'Mot de passe trop court.'},400);
        const salt=randomBytes(24).toString('hex');
        const record={salt,hash:scryptSync(body.password,salt,64).toString('hex'),sessionKey:randomBytes(48).toString('hex'),createdAt:new Date(clock()).toISOString()};
        const created=await db.setJSON('auth',record,{onlyIfNew:true});
        return created.modified?json({ok:true}):json({error:'Le vote est déjà activé.'},409);
      }
      const secret=envPassword||auth?.sessionKey;
      if(!secret || secret.length<12) return json({error:'Le vote collectif attend son activation par le cinéma. Le carnet reste consultable.',code:'SETUP_REQUIRED'},503);
      if(req.method==='POST' && action==='login') {
        if(!await loginAttempt(db,context.ip,secret)) return json({error:'Trop de tentatives. Réessayez dans quinze minutes.'},429);
        const body=await readBody(req);
        const valid=typeof body.password==='string' && body.password.length<=256 && (envPassword?equal(body.password,envPassword):equal(scryptSync(body.password,auth.salt,64).toString('hex'),auth.hash));
        if(body.login!=='selection' || !valid) return json({error:'Identifiant ou mot de passe incorrect.'},401);
        const payload=Buffer.from(JSON.stringify({exp:clock()+12*3600000})).toString('base64url');
        return json({ok:true},200,{'Set-Cookie':setCookie(payload+'.'+sign(payload,secret),43200)});
      }
      if(req.method==='POST' && action==='logout') return json({ok:true},200,{'Set-Cookie':setCookie('',0)});
      if(!cookie(req,secret)) return json({error:'Connectez-vous avec le code du groupe.',code:'LOGIN_REQUIRED'},401);
      if(req.method==='GET') {
        const data=await db.get('state',{type:'json'}) || VoteCore.initial(films,new Date(clock()).toISOString());
        const actor=url.searchParams.get('participant')||'';
        return json(VoteCore.view(data,actor));
      }
      const body=await readBody(req);
      for(let i=0;i<5;i++) {
        const entry=await db.getWithMetadata('state',{type:'json'});
        const previous=entry?.data || VoteCore.initial(films,new Date(clock()).toISOString());
        let next;
        try {next=VoteCore.apply(previous,body,films,new Date(clock()).toISOString());}
        catch(e){return json({error:e.message,code:'VALIDATION'},409);}
        const result=await db.setJSON('state',next,entry?{onlyIfMatch:entry.etag}:{onlyIfNew:true});
        if(result.modified) return json(VoteCore.view(next,body.actor));
      }
      return json({error:'Une autre sauvegarde est en cours. Votre brouillon est conservé ; réessayez.',code:'CONFLICT'},409);
    } catch(e) {
      // Never include storage errors, secrets or request contents in the response.
      if(e instanceof SyntaxError || /requête|Requête|Format/.test(e.message)) return json({error:'Requête invalide.'},400);
      return json({error:'Sauvegarde indisponible. Votre brouillon reste sur cet appareil ; réessayez.',code:'STORAGE'},503);
    }
  };
}
