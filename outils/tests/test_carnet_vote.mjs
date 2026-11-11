import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import V from '../../netlify/lib/carnet-vote/vote-core.js';
import { handler } from '../../netlify/lib/carnet-vote/vote-handler.mjs';
const now='2026-11-11T12:00:00Z';
const films=Array.from({length:40},(_,i)=>({id:'f'+String(i).padStart(2,'0'),title:'Film '+i,countries:i<12?['France','Belgique']:['Japon'],releaseDate:'2027-03-10',releaseStatus:'announced'}));
const ids=films.map(f=>f.id);
function act(s,type,extra={}) {return V.apply(s,{actor:'p1',expectedRevision:s.revision,type,...extra},films,now);}
function opened(){return act(V.initial(films,now),'start');}
function vote(s,p,votes,submitted=true){return act(s,'ballot',{actor:p,roundId:V.current(s).id,ballotRevision:V.current(s).ballots[p]?.revision||0,votes,submitted});}
function closedNomination(){let s=opened();for(const p of s.participants)s=vote(s,p.id,Object.fromEntries(ids.slice(0,25).map(id=>[id,true])));return act(s,'close');}
function judgment(){let s=closedNomination();return act(s,'start',{candidateIds:ids.slice(0,25),reason:'Liste commune convenue.'});}
test('un vote concentré ne crée pas de points supplémentaires ; plafond et coup de cœur contrôlés',()=>{
  let s=opened();s=vote(s,'p1',{f00:true});s=vote(s,'p2',{f00:true,f01:true});
  assert.equal(V.nominationResults(V.current(s))[0].count,2);
  assert.throws(()=>vote(s,'p3',Object.fromEntries(ids.slice(0,26).map(id=>[id,true]))),/Limite/);
  assert.throws(()=>vote(s,'p3',{f00:100}),/Mention/);
  assert.throws(()=>act(s,'ballot',{roundId:'tour-1',ballotRevision:1,votes:{f00:true},wildcard:'f01',submitted:true}),/coup de cœur/);
});
test('mentions médianes basses à effectif pair, résistance à une note extrême, égalités exactes',()=>{
  assert.equal(V.median([5,4,4,3,3,0]),3);
  assert.equal(V.median([5,3,3,3,3]),3);
  assert.equal(V.compareJudgments([5,5,0,0],[0,5,0,5]),0);
  assert.equal(V.compareJudgments([3,3,3,3],[3,3,3,3,3,3]),0);
  assert.ok(V.compareJudgments([4,3,3,3,0],[3,3,3,2,0])<0);
  assert.equal(V.compareJudgments([3,3,0,0],[3,3,3,0,0,0]),0);
});
test('la liste commune conserve les ex aequo et les coups de cœur',()=>{
  let s=opened();for(let i=1;i<=6;i++)s=act(s,'ballot',{actor:'p'+i,roundId:'tour-1',ballotRevision:0,votes:{['f'+String(i+20).padStart(2,'0')]:true,f00:true},wildcard:'f'+String(i+20).padStart(2,'0'),submitted:true});
  const short=V.shortlist(V.current(s),{...s.rules,shortlistTarget:1,shortlistFrench:1},films);
  assert.equal(short.length,7);assert(short.includes('f26'));
});
test('aucun résultat partiel ni avis des autres dans la réponse ouverte ; dévoilement après clôture',()=>{
  let s=opened();s=vote(s,'p1',{f00:true});s=vote(s,'p2',{f01:true});
  assert.deepEqual(Object.keys(V.current(V.view(s,'p1')).ballots),['p1']);
  assert.equal(V.current(V.view(s,'p1')).progress.find(p=>p.id==='p2').submitted,true);
  assert.throws(()=>act(s,'close'),/Chaque participant/);
  for(let i=3;i<=6;i++)s=vote(s,'p'+i,{});
  s=act(s,'close');assert.equal(Object.keys(V.current(V.view(s,'p1')).ballots).length,6);
});
test('révisions, clôture, règles et tours archivés sont protégés',()=>{
  let s=opened();s=vote(s,'p1',{f00:true});
  assert.throws(()=>act(s,'ballot',{roundId:'tour-1',ballotRevision:0,votes:{f02:true},submitted:true}),/autre appareil/);
  assert.throws(()=>act(s,'settings',{rules:s.rules,participants:s.participants}),/figées/);
  s=closedNomination();const snapshot=JSON.stringify(s.rounds[0]);
  const next=act(s,'start',{candidateIds:ids.slice(0,25),reason:'Nouveau tour du groupe'});
  assert.equal(JSON.stringify(next.rounds[0]),snapshot);
  assert.deepEqual(next.rounds[1].ballots,{});
  assert.throws(()=>vote(s,'p1',{f00:true}),/plus ouvert/);
});
test('les abstentions ne sont pas des rejets et ne donnent pas une majorité artificielle',()=>{
  let s=judgment();
  for(let i=1;i<=6;i++)s=vote(s,'p'+i,Object.fromEntries(ids.slice(0,25).map(id=>[id,i<=3?5:null])));
  const row=V.judgmentResults(V.current(s))[0];assert.equal(row.coverage,3);assert.equal(row.median,5);assert.equal(row.qualified,false);
  assert.throws(()=>vote(s,'p1',{f00:5}),/chaque film/);
});
test('programme de 13 films, au moins 5 français, soutien collectif et égalités signalées',()=>{
  let s=judgment();for(let i=1;i<=6;i++)s=vote(s,'p'+i,Object.fromEntries(ids.slice(0,25).map(id=>[id,4])));
  s=act(s,'close');const rec=V.recommendation(V.current(s),s.rules,films);
  assert(rec.complete);assert.equal(rec.ids.length,13);assert(rec.conflicts.length>0);
  assert(rec.ids.filter(id=>V.french(films.find(f=>f.id===id),s.rules)).length>=5);
  assert.throws(()=>act(s,'finalize',{ids:ids.slice(12,25),reason:'Un accord du groupe.'}),/français/);
  s=act(s,'finalize',{ids:rec.ids,reason:'Accord explicite du groupe sur les films ex aequo.'});assert.equal(s.finalSelection.length,13);
  const next=act(s,'start',{candidateIds:ids.slice(0,25),reason:'Une disponibilité a changé.'});assert.equal(next.decisions.length,1);assert.deepEqual(next.decisions[0].ids,rec.ids);
});
class MemoryStore {
  map=new Map();seq=0;
  async get(k){return this.map.has(k)?structuredClone(this.map.get(k).data):null;}
  async getWithMetadata(k){return this.map.has(k)?structuredClone(this.map.get(k)):null;}
  async setJSON(k,v,opts={}){await new Promise(resolve=>setImmediate(resolve));const old=this.map.get(k);if(opts.onlyIfNew&&old || opts.onlyIfMatch&&old?.etag!==opts.onlyIfMatch)return {modified:false};const etag=String(++this.seq);this.map.set(k,{data:structuredClone(v),etag});return {modified:true,etag};}
}
const origin='https://cinema.example';
function req(body,cookie='',action='') {return new Request(origin+'/.netlify/functions/carnet-vote'+action,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},body:body?JSON.stringify(body):undefined});}
async function session(h){const res=await h(req({login:'selection',password:'mot-de-passe-test-uniquement'},'','?action=login'),{ip:'127.0.0.1'});assert.equal(res.status,200);return res.headers.get('set-cookie').split(';')[0];}
test('authentification, origine, cookie HttpOnly, expiration et données privées',async()=>{
  let time=Date.parse(now);const store=new MemoryStore(),h=handler({store:()=>store,films,password:()=> 'mot-de-passe-test-uniquement',clock:()=>time});
  assert.equal((await h(req())).status,401);
  assert.equal((await h(new Request(origin,{method:'POST',body:'{}'}))).status,403);
  const cookie=await session(h);assert.equal((await h(req(null,cookie))).status,200);
  assert.equal((await h(req(null,cookie+'x'))).status,401);
  time+=13*3600000;assert.equal((await h(req(null,cookie))).status,401);
});
test('sauvegardes simultanées : deux participants conservés, même bulletin en conflit',async()=>{
  const db=new MemoryStore();await db.setJSON('state',opened());
  const h=handler({store:()=>db,films,password:()=> 'mot-de-passe-test-uniquement'}),cookie=await session(h);
  const body=(actor,id)=>({type:'ballot',actor,roundId:'tour-1',ballotRevision:0,votes:{[id]:true},submitted:false});
  const results=await Promise.all([h(req(body('p1','f00'),cookie)),h(req(body('p2','f01'),cookie))]);
  assert(results.every(r=>r.status===200));assert.deepEqual(Object.keys(V.current(await db.get('state')).ballots).sort(),['p1','p2']);
  const conflicts=await Promise.all([h(req(body('p3','f02'),cookie)),h(req(body('p3','f03'),cookie))]);
  assert.deepEqual(conflicts.map(r=>r.status).sort(),[200,409]);
});
test('activation à usage unique et mot de passe haché, sans données d’authentification dans la réponse',async()=>{
  const db=new MemoryStore(),token='token-test-avec-beaucoup-de-caracteres',hash=createHash('sha256').update(token).digest('hex');
  const h=handler({store:()=>db,films,password:()=>undefined,bootstrapHash:()=>hash});
  assert.equal((await h(req())).status,503);
  assert.equal((await h(req({token:'faux',password:'mot-de-passe-test-uniquement'},'','?action=setup'))).status,403);
  assert.equal((await h(req({token,password:'mot-de-passe-test-uniquement'},'','?action=setup'))).status,200);
  assert.equal((await h(req({token,password:'autre-mot-de-passe'},'','?action=setup'))).status,409);
  const auth=await db.get('auth');assert(!JSON.stringify(auth).includes('mot-de-passe-test-uniquement'));
  const cookie=await session(h),text=await (await h(req(null,cookie))).text();assert(!text.includes(auth.hash));assert(!text.includes(auth.sessionKey));
});
test('limitation des tentatives de connexion',async()=>{
  const db=new MemoryStore(),h=handler({store:()=>db,films,password:()=> 'mot-de-passe-test-uniquement'});
  for(let i=0;i<12;i++)assert.equal((await h(req({login:'selection',password:'faux'},'','?action=login'),{ip:'test'})).status,401);
  assert.equal((await h(req({login:'selection',password:'faux'},'','?action=login'),{ip:'test'})).status,429);
});
