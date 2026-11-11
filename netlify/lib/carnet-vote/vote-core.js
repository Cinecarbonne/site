(function (root) {
  'use strict';
  const GRADES = ['À écarter', 'Réserves', 'Pourquoi pas', 'Favorable', 'Très favorable', 'Prioritaire'];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const eligible = f => f.releaseStatus === 'announced' && !f.isReissue && /^2027-(03|04|05|06)-/.test(f.releaseDate || '') && new Date(f.releaseDate + 'T12:00:00Z').getUTCDay() === 3;
  const french = (f, rules) => own(rules.frenchOverrides || {}, f.id) ? rules.frenchOverrides[f.id] : (f.countries || []).some(c => /^(france|fr)$/i.test(c.trim()));
  const defaults = () => ({ target:13, minFrench:5, nominationMax:25, shortlistTarget:30, shortlistFrench:8, frenchOverrides:{} });
  function initial(films, now) {
    return {version:1, revision:0, rules:defaults(), participants:Array.from({length:6},(_,i)=>({id:'p'+(i+1),name:'Participant '+(i+1),active:true})), rounds:[], finalSelection:[], finalReason:'', decisions:[], audit:[], createdAt:now};
  }
  const active = s => s.participants.filter(p=>p.active);
  const current = s => s.rounds.at(-1);
  function validateRules(r, films) {
    assert([12,13].includes(r.target), 'Choisir 12 ou 13 films.');
    assert([4,5].includes(r.minFrench), 'Choisir au moins 4 ou 5 films français.');
    assert(Number.isInteger(r.nominationMax) && r.nominationMax >= 15 && r.nominationMax <= 30, 'La limite de propositions doit être entre 15 et 30.');
    assert(Number.isInteger(r.shortlistTarget) && r.shortlistTarget >= r.target && r.shortlistTarget <= 50, 'La liste commune doit contenir entre la taille du programme et 50 films.');
    assert(Number.isInteger(r.shortlistFrench) && r.shortlistFrench >= r.minFrench && r.shortlistFrench <= r.shortlistTarget, 'Réserve française invalide.');
    assert(r.frenchOverrides && typeof r.frenchOverrides === 'object' && !Array.isArray(r.frenchOverrides), 'Classement France invalide.');
    for (const [id, v] of Object.entries(r.frenchOverrides)) assert(films.some(f=>f.id===id) && typeof v === 'boolean', 'Classement France invalide.');
  }
  function ballotValid(round, ballot, rules, submit) {
    const votes = ballot.votes;
    assert(votes && typeof votes === 'object' && !Array.isArray(votes), 'Bulletin invalide.');
    for (const [id,v] of Object.entries(votes)) {
      assert(round.candidateIds.includes(id), 'Ce film ne fait pas partie de ce tour.');
      assert(round.kind === 'nomination' ? v === true : v === null || (Number.isInteger(v) && v >= 0 && v <= 5), 'Mention invalide.');
    }
    if (round.kind === 'nomination') {
      assert(Object.keys(votes).length <= rules.nominationMax, 'Limite de propositions dépassée.');
      assert(!ballot.wildcard || votes[ballot.wildcard] === true, 'Le coup de cœur doit faire partie de vos propositions.');
    } else if (submit) assert(round.candidateIds.every(id=>own(votes,id)), 'Évaluez chaque film ou choisissez « Pas assez d’informations ».');
  }
  function nominationResults(round) {
    return round.candidateIds.map(id=>({id,count:round.participantIds.filter(p=>round.ballots[p]?.submitted && round.ballots[p].votes[id]).length})).sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id));
  }
  function shortlist(round, rules, films) {
    const rows = nominationResults(round).filter(x=>x.count>0), result = new Set();
    function take(list, n) {
      const edge = list[Math.min(n,list.length)-1]?.count;
      list.filter(x=>x.count>=edge).forEach(x=>result.add(x.id));
    }
    take(rows, rules.shortlistTarget);
    take(rows.filter(x=>french(films.find(f=>f.id===x.id), rules)),rules.shortlistFrench);
    for(const p of round.participantIds) if(round.ballots[p]?.submitted && round.ballots[p].wildcard) result.add(round.ballots[p].wildcard);
    return [...result];
  }
  const median = values => values.length ? [...values].sort((a,b)=>a-b)[Math.floor((values.length-1)/2)] : null;
  const gcd = (a,b) => b ? gcd(b,a%b) : a;
  function compareJudgments(a,b) {
    if (!a.length || !b.length) return b.length-a.length;
    // Equalize the two empirical distributions before the usual median-removal tie-break.
    const size=a.length*b.length/gcd(a.length,b.length);
    const x=a.flatMap(g=>Array(size/a.length).fill(g)).sort((m,n)=>m-n);
    const y=b.flatMap(g=>Array(size/b.length).fill(g)).sort((m,n)=>m-n);
    while(x.length) { const k=Math.floor((x.length-1)/2), d=y[k]-x[k]; if(d) return d; x.splice(k,1); y.splice(k,1); }
    return 0;
  }
  function judgmentResults(round) {
    const n=round.participantIds.length, quorum=Math.ceil(2*n/3);
    return round.candidateIds.map(id=> {
      const values=round.participantIds.map(p=>round.ballots[p]?.submitted ? round.ballots[p].votes[id] : null).filter(Number.isInteger);
      const support=values.filter(g=>g>=3).length;
      return {id,values,median:median(values),coverage:values.length,quorum,support,total:n,qualified:values.length>=quorum && support>n/2};
    }).sort((a,b)=>(b.coverage>=quorum)-(a.coverage>=quorum)||compareJudgments(a.values,b.values)||a.id.localeCompare(b.id));
  }
  function recommendation(round, rules, films) {
    const rows=judgmentResults(round).filter(r=>r.qualified), picked=[];
    // Greedy lexicographic ranking under a minimum-French constraint; never promotes an unsupported film.
    for(let i=0;i<rows.length && picked.length<rules.target;i++) {
      const row=rows[i], isFR=french(films.find(f=>f.id===row.id),rules);
      const fr=picked.filter(x=>french(films.find(f=>f.id===x.id),rules)).length;
      const remaining=rules.target-picked.length;
      if(isFR || remaining>Math.max(0,rules.minFrench-fr)) picked.push(row);
    }
    const ids=picked.map(r=>r.id), conflicts=[];
    for(const inRow of picked) for(const outRow of rows.filter(r=>!ids.includes(r.id))) {
      if(compareJudgments(inRow.values,outRow.values)!==0) continue;
      const changed=ids.map(id=>id===inRow.id?outRow.id:id);
      if(changed.filter(id=>french(films.find(f=>f.id===id),rules)).length>=rules.minFrench) conflicts.push([inRow.id,outRow.id]);
    }
    return {ids,complete:ids.length===rules.target && ids.filter(id=>french(films.find(f=>f.id===id),rules)).length>=rules.minFrench, conflicts};
  }
  function apply(old, action, films, now) {
    const s=structuredClone(old), r=current(s), who=s.participants.find(p=>p.id===action.actor && p.active);
    assert(who,'Choisissez un participant actif.');
    assert(action.type==='ballot' || action.expectedRevision===s.revision, 'Le groupe a évolué. Actualisez avant de recommencer.');
    const rules=r?.rules || s.rules;
    if(action.type==='settings') {
      assert(!s.rounds.length,'Les règles sont figées dès le premier tour.');
      const next={...s.rules,...action.rules}; validateRules(next,films); s.rules=next;
      assert(Array.isArray(action.participants) && action.participants.length===6,'Six emplacements sont prévus.');
      s.participants=action.participants.map((p,i)=>{
        assert(p.id==='p'+(i+1) && typeof p.name==='string' && p.name.trim().length>=1 && p.name.trim().length<=50 && typeof p.active==='boolean','Participant invalide.');
        return {id:p.id,name:p.name.trim(),active:p.active};
      });
      assert([5,6].includes(active(s).length),'Activez cinq ou six participants.');
    } else if(action.type==='rename') {
      const p=s.participants.find(p=>p.id===action.participantId);
      assert(p && typeof action.name==='string' && action.name.trim().length>0 && action.name.trim().length<=50,'Nom invalide.');
      p.name=action.name.trim();
    } else if(action.type==='start') {
      assert(!r || r.status==='closed','Clôturez le tour en cours.');
      const kind=r ? 'judgment' : 'nomination';
      let candidateIds = !r ? films.filter(eligible).map(f=>f.id) : r.kind==='nomination' ? shortlist(r,r.rules,films) : [...r.candidateIds];
      if(r) {
        assert(Array.isArray(action.candidateIds) && action.candidateIds.length>=s.rules.target,'Vérifiez la liste commune avant de lancer le tour.');
        candidateIds=[...new Set(action.candidateIds)];
        assert(candidateIds.every(id=>films.some(f=>f.id===id && eligible(f))),'La liste contient un film hors de la fenêtre française.');
        assert(candidateIds.filter(id=>french(films.find(f=>f.id===id),s.rules)).length>=s.rules.minFrench,'Pas assez de films français dans la liste commune.');
        assert(typeof action.reason==='string' && action.reason.trim().length>=5,'Indiquez le motif de ce nouveau tour.');
      }
      s.rounds.push({id:'tour-'+(s.rounds.length+1),name:'Tour '+(s.rounds.length+1),kind,status:'open',candidateIds,participantIds:active(s).map(p=>p.id),participantNames:Object.fromEntries(active(s).map(p=>[p.id,p.name])),rules:structuredClone(s.rules),ballots:{},startedAt:now,reason:action.reason||'Présélection initiale'});
      s.finalSelection=[]; s.finalReason='';
    } else if(action.type==='ballot') {
      assert(r && r.status==='open' && r.id===action.roundId,'Ce tour n’est plus ouvert. Votre brouillon est conservé sur cet appareil.');
      assert(r.participantIds.includes(who.id),'Participant absent de ce tour.');
      const previous=r.ballots[who.id];
      assert((previous?.revision||0)===action.ballotRevision,'Votre bulletin a changé sur un autre appareil. Rechargez sa version enregistrée avant de la modifier.');
      assert(typeof action.submitted==='boolean','Validation du bulletin invalide.');
      const b={votes:action.votes,wildcard:action.wildcard||null,submitted:action.submitted,revision:(previous?.revision||0)+1,updatedAt:now};
      ballotValid(r,b,rules,b.submitted); r.ballots[who.id]=b;
    } else if(action.type==='close') {
      assert(r && r.status==='open','Aucun tour ouvert.');
      assert(r.participantIds.every(p=>r.ballots[p]?.submitted),'Chaque participant doit valider son bulletin avant la clôture.');
      r.status='closed'; r.closedAt=now;
    } else if(action.type==='finalize') {
      assert(r?.kind==='judgment' && r.status==='closed','Clôturez un tour d’évaluation avant de finaliser.');
      assert(Array.isArray(action.ids),'Sélection invalide.');
      const ids=[...new Set(action.ids)], rows=judgmentResults(r), qualified=new Set(rows.filter(x=>x.qualified).map(x=>x.id));
      assert(ids.length===rules.target,`Il faut ${rules.target} films.`);
      assert(ids.every(id=>qualified.has(id) && films.some(f=>f.id===id && eligible(f))),'Chaque film doit avoir assez d’avis, le soutien de la majorité du groupe et une date compatible.');
      assert(ids.filter(id=>french(films.find(f=>f.id===id),rules)).length>=rules.minFrench,`Il faut au moins ${rules.minFrench} films français.`);
      assert(typeof action.reason==='string' && action.reason.trim().length>=10,'Consignez la décision du groupe et le départage des éventuelles égalités.');
      s.finalSelection=ids; s.finalReason=action.reason.trim();
      (s.decisions ||= []).push({ids:[...ids],reason:s.finalReason,roundId:r.id,actor:who.id,at:now});
    } else throw Error('Action inconnue.');
    s.revision++;
    s.audit.push({at:now,actor:who.id,type:action.type,roundId:current(s)?.id||null,revision:s.revision});
    return s;
  }
  function view(s, actor) {
    const out=structuredClone(s);
    out.rounds=out.rounds.map(r=>{
      r.progress=r.participantIds.map(id=>({id,submitted:!!r.ballots[id]?.submitted,updatedAt:r.ballots[id]?.updatedAt||null}));
      if(r.status==='open') r.ballots=own(r.ballots,actor)?{[actor]:r.ballots[actor]}:{};
      return r;
    });
    return out;
  }
  const api={GRADES,own,eligible,french,defaults,initial,active,current,median,compareJudgments,nominationResults,shortlist,judgmentResults,recommendation,apply,view};
  if(typeof module!=='undefined' && module.exports) module.exports=api; else root.VoteCore=api;
})(typeof window!=='undefined'?window:globalThis);
