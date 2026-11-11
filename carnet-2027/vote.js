(() => {
  'use strict';
  const V=window.VoteCore, films=window.FESTIVAL_CATALOG.films, byId=new Map(films.map(f=>[f.id,f]));
  const api='./../../.netlify/functions/carnet-vote';
  const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const date=v=>v?new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(v)):'';
  const colors=['#a94848','#b57948','#d1b253','#81a677','#54875e','#28583f'];
  let state=null, actor='', ballot=null, dirty=false, saving=false, timer, page='ballot', change=0, selectedRound='';
  try { actor=localStorage.getItem('cine-collectif-participant')||''; } catch {}
  const r=()=>V.current(state), draftKey=()=>`cine-collectif-draft:${location.origin}:${r()?.id}:${actor}`;
  const actorName=id=>state.participants.find(p=>p.id===id)?.name||id;
  function confirmAction(message) {
    return new Promise(resolve=>{
      const dialog=$('confirm-dialog'); $('confirm-message').textContent=message;
      const finish=value=>{dialog.close();dialog.oncancel=null;$('confirm-yes').onclick=null;$('confirm-no').onclick=null;resolve(value);};
      $('confirm-yes').onclick=()=>finish(true);$('confirm-no').onclick=()=>finish(false);
      dialog.oncancel=e=>{e.preventDefault();finish(false);};dialog.showModal();$('confirm-no').focus();
    });
  }
  const setMessage=(message,error=false)=>{$('connection').textContent=message;$('connection').className=error?'error':'';};
  function storeDraft() {
    try {localStorage.setItem(draftKey(),JSON.stringify({...ballot,dirty,savedAt:new Date().toISOString()}));}
    catch {$('save-status').textContent='La copie locale est indisponible. Enregistrez votre bulletin en ligne.';}
  }
  async function request(path='',body) {
    const resp=await fetch(api+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    const doc=await resp.json();
    if(!resp.ok){if(resp.status===401){$('login-section').hidden=false;$('vote-app').hidden=true;}throw Error(doc.error||'Connexion impossible.');}
    return doc;
  }
  function loadBallot() {
    const remote=r()?.ballots[actor]||{votes:{},wildcard:null,revision:0,submitted:false};
    ballot=structuredClone(remote);dirty=false;
    try {
      const saved=JSON.parse(localStorage.getItem(draftKey())||'null');
      if(saved?.dirty && saved.revision===remote.revision && r()?.status==='open') {ballot=saved;dirty=true;setMessage('Brouillon retrouvé sur cet appareil. Enregistrez-le ou poursuivez votre saisie.');}
      else if(saved?.dirty && saved.revision!==remote.revision){setMessage('Un ancien brouillon local diffère du bulletin en ligne. Il est conservé : utilisez « Récupérer mon brouillon local » si nécessaire.',true);}
    } catch {}
    change++;
  }
  async function refresh(keepBallot=false) {
    try {
      const doc=await request('?participant='+encodeURIComponent(actor));
      state=doc;
      if(!state.participants.some(p=>p.id===actor&&p.active))actor='';
      $('login-section').hidden=true;$('vote-app').hidden=false;
      setMessage('Espace partagé · résultats dévoilés après clôture');
      if(!keepBallot)loadBallot();render();
    } catch(e){setMessage(e.message,true);}
  }
  function render() {
    $('participant').innerHTML='<option value="">Choisir mon nom…</option>'+state.participants.filter(p=>p.active).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');$('participant').value=actor;
    $('round-label').innerHTML=r()?`<strong>${esc(r().name)} · ${r().kind==='nomination'?'Présélection':'Évaluation'}</strong><br><small>${r().status==='open'?'Vote ouvert':'Tour clôturé'}</small>`:'<strong>Préparation du premier tour</strong>';
    const progress=r()?.progress||[];
    $('progress').innerHTML=progress.map(p=>`<span class="participant-chip ${p.submitted?'done':''}">${esc(actorName(p.id))} · ${p.submitted?'validé':'à compléter'}</span>`).join('');
    document.querySelectorAll('[data-page]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.page===page));
    ['ballot','results','organize','method'].forEach(p=>$('page-'+p).hidden=page!==p);
    renderBallot(); if(page==='results')renderResults();if(page==='organize')renderOrganization();
  }
  function renderBallot() {
    const round=r();
    const usable=actor && round?.status==='open';
    $('ballot-tools').hidden=!usable;$('ballot-save').hidden=!usable;
    if(!actor){$('ballot-info').innerHTML='<div class="vote-box"><h2>Commencez par choisir votre nom</h2><p>Chaque participant dispose de son propre bulletin. Vous pourrez revenir le modifier depuis un autre ordinateur.</p></div>';$('ballot-list').innerHTML='';return;}
    if(!round){$('ballot-info').innerHTML='<div class="vote-box"><h2>Le groupe se prépare</h2><p>Vérifiez les participants et les règles dans l’onglet Organisation, puis ouvrez le premier tour.</p></div>';$('ballot-list').innerHTML='';return;}
    if(round.status==='closed'){$('ballot-info').innerHTML='<div class="vote-box"><h2>Ce tour est terminé</h2><p>Retrouvez les bulletins et le classement dans Résultats & tours. Un nouveau tour permet de revoir vos choix sans effacer celui-ci.</p></div>';$('ballot-list').innerHTML='';return;}
    $('ballot-info').innerHTML=round.kind==='nomination'?`<div class="vote-box"><h2>Quels films voulez-vous explorer ensemble ?</h2><p>Jusqu’à <strong>${round.rules.nominationMax} propositions</strong>, une voix par film. Désignez éventuellement un coup de cœur à défendre lors de la discussion. Vous n’êtes pas obligé de remplir la liste.</p></div>`:`<div class="vote-box"><h2>Votre avis sur les ${round.candidateIds.length} films de la liste commune</h2><p>Une mention pour chaque film. Si vous manquez d’informations, dites-le : cela ne compte pas comme un rejet. Vos avis restent modifiables jusqu’à la clôture.</p></div>`;
    renderList();renderCounter();
  }
  function renderList() {
    const round=r();if(!round||!actor||round.status!=='open')return;
    const query=norm($('vote-search').value).trim(),filter=$('vote-filter').value;
    const ids=round.candidateIds.filter(id=>{
      const f=byId.get(id), chosen=V.own(ballot.votes,id);
      return f && (!query||query.split(/\s+/).every(w=>norm([f.title,f.director,...f.countries].join(' ')).includes(w))) && (filter==='all'||filter==='selected'&&chosen||filter==='remaining'&&!chosen||filter==='french'&&V.french(f,round.rules));
    }).sort((a,b)=>byId.get(a).title.localeCompare(byId.get(b).title,'fr'));
    $('ballot-list').innerHTML=ids.map(id=>{
      const f=byId.get(id), chosen=V.own(ballot.votes,id), img=f.poster?.thumbLocal||f.poster?.local||'', fr=V.french(f,round.rules);
      const controls=round.kind==='nomination'?`<button data-propose="${esc(id)}" aria-pressed="${chosen}">${chosen?'✓ Proposé':'Proposer ce film'}</button>${chosen?`<button data-wildcard="${esc(id)}" aria-pressed="${ballot.wildcard===id}" title="Un seul coup de cœur par personne">${ballot.wildcard===id?'★':'☆'} Coup de cœur</button>`:''}`:`<label class="sr-only" for="grade-${esc(id)}">Votre avis sur ${esc(f.title)}</label><select id="grade-${esc(id)}" data-grade="${esc(id)}"><option value="unset">Choisir une mention…</option>${V.GRADES.map((g,i)=>`<option value="${i}" ${chosen&&ballot.votes[id]===i?'selected':''}>${g}</option>`).join('')}<option value="abstain" ${chosen&&ballot.votes[id]===null?'selected':''}>Pas assez d’informations</option></select>`;
      return `<article class="vote-row ${chosen?'picked':''}" id="vote-${esc(id)}">${img?`<img src="${esc(img)}" alt="" loading="lazy">`:'<div></div>'}<div><h3>${esc(f.title)}</h3><p><span class="badge-fr" ${fr?'':'hidden'}>France</span>${esc(f.director)} · ${esc(f.duration||'Durée à confirmer')}</p><p class="muted">${esc(f.releaseDate?.split('-').reverse().join('/'))} · ${esc((f.genres||[]).join(', '))}</p><details><summary>Synopsis</summary><p>${esc(f.synopsis)}</p></details><a href="index.html#film/${encodeURIComponent(id)}/film" target="_blank" rel="noopener">Fiche, bande-annonce et photos ↗</a></div><div class="vote-controls">${controls}</div></article>`;
    }).join('')||'<p class="vote-box">Aucun film ne correspond à cette recherche.</p>';
  }
  function renderCounter() {
    if(!r()||!ballot)return;
    const n=Object.keys(ballot.votes).length;
    $('ballot-count').textContent=r().kind==='nomination'?`${n} / ${r().rules.nominationMax} films proposés`:`${n} / ${r().candidateIds.length} réponses · ${Object.values(ballot.votes).filter(v=>v===null).length} sans avis`;
    $('submit-ballot').disabled=saving || r().kind==='judgment'&&n!==r().candidateIds.length;
    $('save-draft').disabled=saving;
    $('submit-ballot').textContent=ballot.submitted&&!dirty?'Bulletin validé ✓':'Valider mon bulletin';
    if(!saving)$('save-status').textContent=dirty?'Modifications en cours d’enregistrement…':ballot.submitted?'Bulletin validé. Toute modification demandera une nouvelle validation.':ballot.updatedAt?'Brouillon enregistré en ligne · '+date(ballot.updatedAt):'Vos choix seront enregistrés pendant la saisie.';
  }
  function edit() {
    dirty=true;ballot.submitted=false;change++;storeDraft();renderCounter();clearTimeout(timer);timer=setTimeout(()=>save(false),900);
  }
  async function save(submitted=false) {
    clearTimeout(timer);if(saving||!actor||!r()||r().status!=='open')return false;
    saving=true;renderCounter();$('save-status').textContent='Enregistrement partagé…';
    const before=change, roundId=r().id;
    try {
      const result=await request('',{type:'ballot',actor,roundId,ballotRevision:ballot.revision||0,votes:structuredClone(ballot.votes),wildcard:ballot.wildcard,submitted});
      state=result;
      const remote=r().ballots[actor];ballot.revision=remote.revision;ballot.updatedAt=remote.updatedAt;
      dirty=before!==change;ballot.submitted=dirty?false:submitted;storeDraft();
      setMessage(submitted&&!dirty?'Votre bulletin est validé. Vous pouvez encore le modifier tant que le tour reste ouvert.':'Brouillon enregistré sur le carnet partagé.');
      return true;
    } catch(e){setMessage(e.message,true);$('save-status').textContent='Non enregistré en ligne · copie locale conservée';return false;}
    finally {saving=false;renderCounter();if(dirty&&before!==change)timer=setTimeout(()=>save(false),900);}
  }
  async function command(body) {
    if(!actor)return setMessage('Choisissez votre nom.',true);
    try {state=await request('',{...body,actor,expectedRevision:state.revision});loadBallot();render();setMessage('Modification enregistrée pour le groupe.');}
    catch(e){setMessage(e.message,true);}
  }
  function getClosedRound() { const closed=state.rounds.filter(x=>x.status==='closed');return closed.find(x=>x.id===selectedRound)||closed.at(-1); }
  function renderResults() {
    const round=getClosedRound(),closed=state.rounds.filter(x=>x.status==='closed');
    let html=r()?.status==='open'?'<p class="notice">Les résultats du tour en cours seront visibles après sa clôture. Seul l’avancement des bulletins est partagé.</p>':'';
    if(!round){$('page-results').innerHTML=html+'<p class="vote-box">Aucun tour terminé pour le moment.</p>';return;}
    html+=`<label class="round-picker">Consulter un tour<select id="result-round">${closed.map(x=>`<option value="${x.id}" ${x.id===round.id?'selected':''}>${esc(x.name)} · ${x.kind==='nomination'?'Présélection':'Évaluation'} · ${date(x.closedAt)}</option>`).join('')}</select></label><p>${esc(round.reason)}</p><button id="export-results">Télécharger les résultats et bulletins de ce tour</button>`;
    if(round.kind==='nomination') {
      const rows=V.nominationResults(round),common=new Set(V.shortlist(round,round.rules,films));
      html+=`<p>Liste commune suggérée : <strong>${common.size} films</strong>, égalités, coups de cœur et réserve française inclus. Le groupe la vérifie dans Organisation.</p><div class="table-scroll"><table><thead><tr><th>Film</th><th>Propositions</th>${round.participantIds.map(p=>`<th>${esc(round.participantNames[p])}</th>`).join('')}</tr></thead><tbody>${rows.filter(x=>x.count>0).map(x=>`<tr><td>${esc(byId.get(x.id).title)}${common.has(x.id)?' <span class="badge-fr">Liste commune</span>':''}</td><td><strong>${x.count} / ${round.participantIds.length}</strong></td>${round.participantIds.map(p=>`<td>${round.ballots[p]?.votes[x.id]?(round.ballots[p].wildcard===x.id?'★ Coup de cœur':'Oui'):'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } else {
      const rows=V.judgmentResults(round);
      html+='<p>Le classement tient compte de la médiane puis du départage. « Soutiens » compte les mentions Favorable, Très favorable ou Prioritaire sur l’ensemble du groupe. Une égalité exacte reste à discuter.</p><div class="table-scroll"><table><thead><tr><th>Film</th><th>Mention collective</th><th>Avis / soutiens</th>'+round.participantIds.map(p=>`<th>${esc(round.participantNames[p])}</th>`).join('')+'</tr></thead><tbody>';
      html+=rows.map((x,i)=>{const tied=rows.some((y,j)=>j!==i&&V.compareJudgments(x.values,y.values)===0&&x.coverage>=x.quorum&&y.coverage>=y.quorum);return `<tr><td>${esc(byId.get(x.id).title)}<br>${V.french(byId.get(x.id),round.rules)?'<span class="badge-fr">France</span>':''}${tied?'<span class="tie">Égalité exacte</span>':''}</td><td><strong>${x.coverage>=x.quorum?esc(V.GRADES[x.median]):'Avis insuffisants'}</strong><div class="rank-bands" aria-hidden="true">${V.GRADES.map((g,i)=>`<span style="background:${colors[i]};flex:${x.values.filter(v=>v===i).length}"></span>`).join('')}</div></td><td>${x.coverage}/${x.total} avis<br>${x.support}/${x.total} soutiens<br><small>${x.qualified?'Majorité favorable':'À rediscuter'}</small></td>${round.participantIds.map(p=>`<td>${Number.isInteger(round.ballots[p]?.votes[x.id])?esc(V.GRADES[round.ballots[p].votes[x.id]]):'Sans avis'}</td>`).join('')}</tr>`;}).join('');
      html+='</tbody></table></div>';
    }
    $('page-results').innerHTML=html;
  }
  function candidates(ids,field,available) {
    const selected=new Set(ids);
    return `<div class="selection-list">${available.map(f=>`<label class="inline"><input type="checkbox" name="${field}" value="${esc(f.id)}" ${selected.has(f.id)?'checked':''}>${esc(f.title)} ${V.french(f,state.rules)?'<span class="badge-fr">France</span>':''}</label>`).join('')}</div>`;
  }
  function renderOrganization() {
    const round=r(),rules=state.rules, count=V.active(state).length;
    let html='<div class="vote-box"><h2>Organisation du groupe</h2><p>À utiliser ensemble : une seule personne prépare les règles et ouvre ou clôture les tours. Le mot de passe commun ne distingue pas un administrateur.</p>';
    if(!round) {
      html+=`<form id="settings-form"><div class="organize-grid">${state.participants.map(p=>`<div><label>Nom ${p.id.slice(1)}<input name="name-${p.id}" value="${esc(p.name)}" maxlength="50" required></label><label class="inline"><input type="checkbox" name="active-${p.id}" ${p.active?'checked':''}>Participe au vote</label></div>`).join('')}<label>Films au programme<select name="target"><option ${rules.target===12?'selected':''}>12</option><option ${rules.target===13?'selected':''}>13</option></select></label><label>Minimum de films français<select name="minFrench"><option ${rules.minFrench===4?'selected':''}>4</option><option ${rules.minFrench===5?'selected':''}>5</option></select></label><label>Propositions maximum par personne<input type="number" name="nominationMax" min="15" max="30" value="${rules.nominationMax}"></label><label>Taille visée de la liste commune<input type="number" name="shortlistTarget" min="13" max="50" value="${rules.shortlistTarget}"></label><label>Réserve française dans la liste commune<input type="number" name="shortlistFrench" min="5" max="30" value="${rules.shortlistFrench}"></label></div><details><summary>Quels films comptent comme français ?</summary><p>Par défaut, toutes les coproductions avec la France. Corrigez si votre règle de programmation est différente.</p>${candidates(films.filter(f=>V.french(f,rules)).map(f=>f.id),'french',films.filter(V.eligible))}</details><button class="primary" type="submit">Enregistrer les règles et les noms</button></form><p>Règles figées à l’ouverture pour que tous votent à égalité. Les noms restent modifiables.</p><button id="start-first" class="primary">Ouvrir la présélection</button>`;
    } else {
      html+=`<div class="method-summary"><span>${count} participants</span><span>${rules.target} films</span><span>Au moins ${rules.minFrench} français</span><span>${rules.nominationMax} propositions maximum</span></div><details><summary>Modifier les noms</summary><form id="rename-form"><label>Participant<select name="participantId">${state.participants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label>Nouveau nom<input name="name" maxlength="50" required></label><button>Renommer</button></form><p>Les anciens tours conservent les noms utilisés au moment du vote.</p></details>`;
      if(round.status==='open') html+=`<h3>Clôturer ${esc(round.name)}</h3><p>Les résultats seront révélés et le tour sera archivé. Tous les bulletins doivent être validés. Les changements ultérieurs se font dans un nouveau tour.</p><button id="close-round" ${round.participantIds.every(p=>round.progress.find(x=>x.id===p)?.submitted)?'':'disabled'}>Clôturer et révéler les résultats</button>`;
      else {
        const next=round.kind==='nomination'?V.shortlist(round,round.rules,films):round.candidateIds;
        html+=`<h3>Préparer le tour ${state.rounds.length+1}</h3><p>Vérifiez la liste, puis indiquez ce que ce tour doit résoudre. Il sera possible d’ajouter un nouveau film du carnet ou de retirer un titre indisponible.</p><form id="next-form">${candidates(next,'candidate',films.filter(V.eligible).sort((a,b)=>a.title.localeCompare(b.title,'fr')))}<label>Motif / accord du groupe<textarea name="reason" required minlength="5" placeholder="Liste commune après la présélection ; films à revoir ensemble…"></textarea></label><button class="primary">Ouvrir un nouveau tour d’évaluation</button></form>`;
        if(round.kind==='judgment') {
          const rec=V.recommendation(round,round.rules,films),qualified=V.judgmentResults(round).filter(x=>x.qualified).map(x=>byId.get(x.id));
          html+=`<h3>Valider le programme du groupe</h3><p>Suggestion respectant le classement et la contrainte française : ${rec.ids.length} films. ${rec.complete?'':'Il manque des films éligibles et soutenus : discutez puis ouvrez un nouveau tour.'}</p>${rec.conflicts.length?'<p class="notice">Des films à égalité traversent la limite de sélection. Les cases ci-dessous sont une proposition de travail, pas un départage. Consignez le choix collectif ou revotez.</p>':''}<form id="final-form">${candidates(state.finalSelection.length?state.finalSelection:rec.ids,'final',qualified)}<label>Décision collective, égalités et disponibilités<textarea name="reason" required minlength="10" placeholder="Accord du groupe, choix entre les ex æquo, confirmation des disponibilités…">${esc(state.finalReason)}</textarea></label><button class="primary">Consigner le programme validé par le groupe</button></form>`;
        }
      }
    }
    html+='</div>';
    if(state.finalSelection.length)html+=`<section class="vote-box"><h2>Programme retenu</h2><ol>${state.finalSelection.map(id=>`<li>${esc(byId.get(id).title)}</li>`).join('')}</ol><p>${esc(state.finalReason)}</p></section>`;
    if(state.decisions?.length)html+=`<details class="vote-box"><summary>Décisions de programmation précédentes</summary>${state.decisions.slice().reverse().map(d=>`<h3>${esc(d.roundId)} · ${date(d.at)}</h3><p>${esc(d.reason)}</p><p>${d.ids.map(id=>esc(byId.get(id)?.title||id)).join(' · ')}</p>`).join('')}</details>`;
    html+=`<details class="vote-box"><summary>Historique des opérations</summary><ul class="audit">${state.audit.slice().reverse().map(a=>`<li>${date(a.at)} · ${esc(actorName(a.actor))} · ${esc({settings:'règles enregistrées',rename:'nom modifié',start:'tour ouvert',ballot:'bulletin enregistré',close:'tour clôturé',finalize:'programme consigné'}[a.type]||a.type)}</li>`).join('')||'<li>Aucune opération pour le moment.</li>'}</ul></details><button id="recover-draft">Récupérer mon brouillon local</button> <button id="reload-ballot">Charger le bulletin enregistré en ligne</button>`;
    $('page-organize').innerHTML=html;
  }
  $('login-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await request('?action=login',{login:f.get('login'),password:f.get('password')});e.target.elements.namedItem('password').value='';await refresh();}catch(err){setMessage(err.message,true);}});
  $('participant').addEventListener('change',async e=>{
    const next=e.target.value;if(saving){e.target.value=actor;return setMessage('Attendez la fin de l’enregistrement.',true);}
    if(dirty&&!await save(false)){e.target.value=actor;return;}
    actor=next;try{localStorage.setItem('cine-collectif-participant',actor);}catch{}await refresh();
  });
  $('refresh').onclick=async()=>{if(saving)return;if(dirty&&!await save(false))return;await refresh();};
  $('logout').onclick=async()=>{if(saving)return;if(dirty&&!await save(false))return;try{await request('?action=logout',{});state=null;$('vote-app').hidden=true;$('login-section').hidden=false;setMessage('Vous êtes déconnecté.');}catch(e){setMessage(e.message,true);}};
  $('vote-search').oninput=renderList;$('vote-filter').onchange=renderList;
  $('save-draft').onclick=()=>save(false);$('submit-ballot').onclick=()=>save(true);
  document.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.page){page=b.dataset.page;render();}
    if(b.dataset.propose){const id=b.dataset.propose;if(ballot.votes[id]){delete ballot.votes[id];if(ballot.wildcard===id)ballot.wildcard=null;}else {if(Object.keys(ballot.votes).length>=r().rules.nominationMax)return setMessage('Limite atteinte : retirez d’abord une proposition.',true);ballot.votes[id]=true;}edit();renderList();}
    if(b.dataset.wildcard){ballot.wildcard=ballot.wildcard===b.dataset.wildcard?null:b.dataset.wildcard;edit();renderList();}
    if(b.id==='start-first' && await confirmAction('Ouvrir le premier tour avec les règles enregistrées ? Elles ne pourront plus être modifiées pendant cette consultation.'))await command({type:'start'});
    if(b.id==='close-round' && await confirmAction('Tous les bulletins sont validés. Clôturer ce tour et révéler les avis de chacun ?'))await command({type:'close'});
    if(b.id==='recover-draft'){
      try{const d=JSON.parse(localStorage.getItem(draftKey())||'null'),roundId=r()?.id;if(!actor||!d||r()?.status!=='open')return setMessage('Aucun brouillon récupérable pour ce participant et ce tour.',true);if(await confirmAction('Reprendre le brouillon local dans l’éditeur ? Il ne remplacera le bulletin en ligne qu’après votre sauvegarde.')){clearTimeout(timer);state=await request('?participant='+encodeURIComponent(actor));if(r()?.id!==roundId||r().status!=='open')return render();ballot={...d,revision:r().ballots[actor]?.revision||0,submitted:false};dirty=true;change++;page='ballot';render();setMessage('Brouillon local récupéré. Vérifiez-le puis enregistrez.');}}catch{setMessage('Ce brouillon ne peut pas être lu.',true);}
    }
    if(b.id==='reload-ballot'&&!saving&&await confirmAction('Recharger le bulletin du serveur ? Votre brouillon local restera conservé séparément.')){
      clearTimeout(timer);try{state=await request('?participant='+encodeURIComponent(actor));ballot=structuredClone(r()?.ballots[actor]||{votes:{},wildcard:null,revision:0,submitted:false});dirty=false;change++;page='ballot';render();setMessage('Version enregistrée chargée. Le bouton de récupération reste disponible pour votre ancien brouillon.');}catch(err){setMessage(err.message,true);}
    }
    if(b.id==='export-results'){
      const round=getClosedRound();const blob=new Blob([JSON.stringify({format:'cine-carbonne-vote',version:1,round,films:round.candidateIds.map(id=>({id,title:byId.get(id).title}))},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cine-carbonne-'+round.id+'.json';a.click();URL.revokeObjectURL(url);
    }
  });
  document.addEventListener('change',e=>{
    if(e.target.dataset.grade){const id=e.target.dataset.grade,v=e.target.value;if(v==='unset')delete ballot.votes[id];else ballot.votes[id]=v==='abstain'?null:Number(v);edit();e.target.closest('.vote-row').classList.toggle('picked',v!=='unset');}
    if(e.target.id==='result-round'){selectedRound=e.target.value;renderResults();}
  });
  document.addEventListener('submit',async e=>{
    const id=e.target.id;if(!['settings-form','rename-form','next-form','final-form'].includes(id))return;e.preventDefault();const f=new FormData(e.target);
    if(id==='settings-form'){
      const overrides={}, selected=new Set(f.getAll('french'));for(const film of films.filter(V.eligible))overrides[film.id]=selected.has(film.id);
      await command({type:'settings',rules:{target:Number(f.get('target')),minFrench:Number(f.get('minFrench')),nominationMax:Number(f.get('nominationMax')),shortlistTarget:Number(f.get('shortlistTarget')),shortlistFrench:Number(f.get('shortlistFrench')),frenchOverrides:overrides},participants:state.participants.map(p=>({id:p.id,name:f.get('name-'+p.id),active:f.has('active-'+p.id)}))});
    }
    if(id==='rename-form')await command({type:'rename',participantId:f.get('participantId'),name:f.get('name')});
    if(id==='next-form'&&await confirmAction('Ouvrir ce nouveau tour avec des bulletins vierges ? Le tour précédent restera consultable.'))await command({type:'start',candidateIds:f.getAll('candidate'),reason:f.get('reason')});
    if(id==='final-form'&&await confirmAction('Consigner cette sélection comme décision du groupe ?'))await command({type:'finalize',ids:f.getAll('final'),reason:f.get('reason')});
  });
  window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
  setInterval(()=>{if(state&&!dirty&&!saving&&page==='ballot'&&document.activeElement===document.body&&!document.hidden)refresh();},60000);
  const requested=new URLSearchParams(location.search).get('film');if(requested&&byId.has(requested))$('vote-search').value=byId.get(requested).title;
  refresh();
})();
