(() => {
  'use strict';
  const C = window.CatalogCore;
  const catalog = window.FESTIVAL_CATALOG || {films:[],meta:{}};
  const films = catalog.films;
  const byId = new Map(films.map(f => [f.id,f]));
  const state = {view:'calendar',date:C.dates[0],query:'',genre:'',openId:null,tab:'film'};
  let ratings = {}, toastTimer;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeURL = value => {try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }};
  const assetURL = item => item?.local && /^assets\/[a-zA-Z0-9_./-]+$/.test(item.local) ? item.local : safeURL(item?.url);
  const link = (url,label,cls='') => safeURL(url) ? `<a class="${cls}" href="${esc(safeURL(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} <span aria-hidden="true">↗</span></a>` : esc(label);
  const fullDate = date => date ? new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z')) : 'Date française non annoncée';
  const shortDate = date => date ? new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z')) : 'À suivre';
  const plural = (n,s,p=s+'s') => `${n} ${n===1?s:p}`;
  const empty = text => `<p class="empty-data">${esc(text)}</p>`;
  const names = values => (values||[]).map(v=>typeof v==='string'?v:(v.name||v.label||'')).filter(Boolean).join(', ');
  const ofName = name=>/^[aeiouyhàâäéèêëîïôöùûüœ]/i.test(name||'')?'d’'+name:'de '+name;
  const durationText = value => (value || '').replace(/(\d+)\s*h\s*(\d{2})/i, '$1 h $2');
  const sourceUrl = source => typeof source==='string'?source:source?.url;
  function notify(message) { $('toast').textContent=message; $('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4300); }
  const book = window.CarnetNotes(new Set(byId.keys()), (next, edited) => {
    ratings = next;
    if (edited || !document.querySelector('.video-stage iframe')) render(true);
  }, message => { $('sync-status').textContent = message; });
  document.querySelector('.backup-actions').hidden = !book.editable;
  $('rated-view-label').textContent = book.editable ? 'Mes films notés' : 'Films notés';
  function counts() {
    const dated=films.filter(C.isCalendar).length;
    $('inventory').innerHTML=`<b>${plural(films.length,'film')}</b> repérés &nbsp;·&nbsp; <b>18 mercredis</b> à explorer &nbsp;·&nbsp; mars → juin`;
    $('calendar-count').textContent=dated;
    $('watch-count').textContent=films.length-dated;
    $('rated-count').textContent=films.filter(f=>C.scoreOf(ratings,f.id)!==null).length;
    document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===state.view));
  }
  function calendar() {
    $('calendar-panel').hidden=state.view!=='calendar';
    const month=state.date.slice(5,7);
    $('months').innerHTML=[['03','Mars'],['04','Avril'],['05','Mai'],['06','Juin']].map(([m,label])=>`<button data-month="${m}" aria-pressed="${m===month}">${label}</button>`).join('');
    const dates=C.dates.filter(d=>d.slice(5,7)===month);
    $('weeks').style.gridTemplateColumns=`repeat(${dates.length},minmax(0,1fr))`;
    $('weeks').innerHTML=dates.map(date=>{
      const n=films.filter(f=>C.isCalendar(f)&&f.releaseDate===date).length;
      const rated=films.some(f=>f.releaseDate===date&&C.scoreOf(ratings,f.id)!==null);
      return `<button class="week" data-date="${date}" aria-pressed="${state.date===date}" aria-label="Mercredi ${fullDate(date)}, ${plural(n,'film')}"><small>Mercredi</small><strong>${Number(date.slice(8))}<span class="month-word">${new Intl.DateTimeFormat('fr-FR',{month:'short',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))}</span></strong><span class="film-number">${plural(n,'film')}</span>${rated?'<span class="week-dot" title="Contient un film noté">●</span>':''}</button>`;
    }).join('');
    $('previous-week').disabled=C.dates.indexOf(state.date)===0;
    $('next-week').disabled=C.dates.indexOf(state.date)===C.dates.length-1;
  }
  function label(f) {
    if(f.isReissue) return 'Reprise / réédition';
    if(f.releaseStatus==='outside') return 'Hors période · '+shortDate(f.releaseDate);
    if(f.releaseStatus==='conflicting') return 'Date à vérifier';
    return f.releaseDate ? shortDate(f.releaseDate)+' 2027' : 'Piste festival';
  }
  function imageBadge(p) {
    if (!p || p.kind==='poster') return '';
    if (p.kind==='director' || p.kind==='cast') return p.badge;
    return 'Visuel provisoire';
  }
  function poster(f) {
    const p=f.poster;
    const url=p?.thumbLocal ? assetURL({local:p.thumbLocal}) || assetURL(p) : assetURL(p);
    const badge=imageBadge(p);
    const caption=p?.caption || 'Visuel de '+f.title;
    return `<span class="poster-fallback" ${url?'hidden':''}><span class="placeholder-kicker">CINÉ CARBONNE · REPÉRAGE</span><strong>${esc(f.title)}</strong><small>Image indisponible</small></span>${url?`<img src="${esc(url)}" alt="${esc(caption)}" loading="lazy" decoding="async" data-poster="${esc(f.id)}" data-kind="${esc(p.kind)}">`:''}${url&&badge?`<span class="media-kind" title="${esc(caption)}">${esc(badge)}</span>`:''}`;
  }
  function card(f) {
    const score=C.scoreOf(ratings,f.id);
    const award=f.awards?.[0];
    return `<article class="film-card" id="card-${esc(f.id)}"><button class="film-toggle" data-film="${esc(f.id)}" aria-expanded="${state.openId===f.id}" aria-controls="film-detail" aria-label="${state.openId===f.id?'Fermer':'Ouvrir'} la fiche de ${esc(f.title)}"><span class="poster-wrap">${poster(f)}${score!==null?`<span class="score-badge" aria-label="Note de programmation ${score} sur 10"><b>${score}</b> /10</span>`:''}<span class="poster-bottom"><span class="date-tag">${esc(label(f))}</span><span class="open-symbol" aria-hidden="true">${state.openId===f.id?'−':'+'}</span></span></span><span class="film-title">${esc(f.title)}</span><span class="film-meta">${esc(names(f.genres)||'Genre à préciser')}</span><span class="film-director">${f.director?'De '+esc(f.director):'Réalisation à confirmer'}</span><span class="film-specs">${esc(durationText(f.duration) || 'Durée non annoncée')} · ${esc(names(f.countries) || 'Pays non communiqué')}</span><span class="film-blurb">${esc(f.synopsis || 'Synopsis non communiqué dans les sources consultées.')}</span></button>${award?`<div class="card-festival">✦ ${esc(award.award||award.name||'Prix en festival')} · ${esc(award.festival||'')}${award.year?' '+esc(award.year):''}</div>`:''}</article>`;
  }
  function detailAlert(f) {
    if(f.isReissue) return '<p class="detail-alert"><strong>Reprise / réédition.</strong> À considérer à part : ce film a déjà connu une sortie en France.</p>';
    if(f.releaseStatus==='outside') return `<p class="detail-alert"><strong>Sortie hors période : ${esc(fullDate(f.releaseDate))}.</strong> Ce film est conservé avec ses notes, mais sa date actuelle ne permet plus de le retenir dans les mercredis d’avant-première du carnet.</p>`;
    if(f.releaseStatus==='conflicting') return '<p class="detail-alert"><strong>Date française à vérifier.</strong> Les sources ne permettent pas de confirmer un mercredi de sortie. Ce film est conservé comme piste, hors calendrier vérifié.</p>';
    if(!f.releaseDate) return '<p class="detail-alert"><strong>Piste de festival.</strong> Pas de date française confirmée dans cette recherche. Vérifier la sortie, les droits France et la disponibilité avant de le retenir.</p>';
    if(f.releaseDate==='2027-03-03') return '<p class="detail-alert"><strong>Avant-première possible du 26 février au 2 mars.</strong> À partir du mercredi 3 mars, le film sera en sortie nationale si cette date est maintenue.</p>';
    return '';
  }
  function contact(f) {
    const d=f.distributor||{};
    const email=d.email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) ? `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`:'';
    const phone=d.phone?`<a href="tel:${esc(d.phone.replace(/[^\d+]/g,''))}">${esc(d.phone)}</a>`:'';
    return `<aside class="facts"><h3>Pour la programmation</h3><dl><dt>Sortie nationale française</dt><dd>${esc(f.releaseWindow||fullDate(f.releaseDate))}${f.releaseStatus==='conflicting'?' · à vérifier':''}</dd><dt>Distribution France</dt><dd>${d.name?esc(d.name):'Non identifiée dans cette recherche'}</dd><dt>Production</dt><dd>${f.production?.length?esc(names(f.production)):'Société non vérifiée à ce stade'}</dd><dt>Pays · durée</dt><dd>${esc([names(f.countries),durationText(f.duration)].filter(Boolean).join(' · ')||'À préciser')}</dd>${f.cast?.length?`<dt>Avec</dt><dd>${esc(names(f.cast))}</dd>`:''}</dl><div class="contact-links">${email}${phone}${d.contactUrl?link(d.contactUrl,d.contactLabel||'Contact / programmation'):''}${d.url&&d.url!==d.contactUrl?link(d.url,'Site du distributeur'):''}</div>${!email&&!phone?'<p class="empty-data">Contact direct à compléter'+(d.contactUrl?' depuis le site officiel.':'.')+'</p>':''}${d.contactNote?`<p class="small-text">${esc(d.contactNote)}</p>`:''}${f.internationalSales?`<hr><h3>Ventes internationales</h3><p>${esc(typeof f.internationalSales==='string'?f.internationalSales:f.internationalSales.name)}</p>${f.internationalSales.url?link(f.internationalSales.url,'Contacter le vendeur'):''}${f.internationalSales.email?`<p><a href="mailto:${esc(f.internationalSales.email)}">${esc(f.internationalSales.email)}</a></p>`:''}${f.internationalSales.phone?`<p>${esc(f.internationalSales.phone)}</p>`:''}<p class="empty-data">Ce contact ne confirme pas les droits de distribution en France.</p>`:''}<hr><p class="empty-data">Disponibilité en avant-première et conditions à demander au distributeur.</p></aside>`;
  }
  function filmPane(f) {
    return `<div class="details-layout"><div class="details-copy">${detailAlert(f)}<h3>Le film</h3><p>${esc(f.synopsis||'Le synopsis n’est pas encore disponible dans les sources retenues.')}</p><h3>${f.director?esc(f.director):'La réalisation'}</h3>${f.directorBio?`<p>${esc(f.directorBio)}</p>`:empty('Notice biographique à compléter à partir d’une source vérifiée.')}<h3>Dans les coulisses</h3>${f.productionNotes?.length?`<ul>${f.productionNotes.map(n=>`<li>${esc(typeof n==='string'?n:n.text||n.description||'')}</li>`).join('')}</ul>`:empty('Aucune anecdote de production suffisamment sourcée n’a été retenue pour le moment.')}${f.notes?.length?`<h3>Points à vérifier</h3><ul class="small-text">${f.notes.map(n=>`<li>${esc(typeof n==='string'?n:JSON.stringify(n))}</li>`).join('')}</ul>`:''}</div>${contact(f)}</div>`;
  }
  function youtubeID(url) {
    try {const u=new URL(url);let id='';if(['youtube.com','www.youtube.com','m.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(u.hostname))id=u.searchParams.get('v')||u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1]||'';else if(u.hostname==='youtu.be')id=u.pathname.slice(1);return /^[a-zA-Z0-9_-]{11}$/.test(id)?id:null;}catch{return null;}
  }
  function playerURL(v) {
    const yt=youtubeID(v.url);if(yt)return 'https://www.youtube-nocookie.com/embed/'+yt+'?autoplay=1&rel=0';
    try {
      const u=new URL(v.url);
      if(u.hostname==='vimeo.com'&&/^\/\d+$/.test(u.pathname))return 'https://player.vimeo.com/video'+u.pathname+'?autoplay=1';
      if(['www.allocine.fr','allocine.fr'].includes(u.hostname)){
        const media=u.pathname.match(/cmedia=(\d+)/)?.[1];
        if(media)return 'https://player.allocine.fr/'+media+'.html';
      }
    } catch {}
    return null;
  }
  function videoPane(f) {
    const videos=(f.videos||[]).filter(v=>safeURL(v.url));
    const content=videos.length?`<div class="video-grid">${videos.map((v,i)=>{
      const id=youtubeID(v.url);
      const player=playerURL(v);
      const thumb=v.thumbnail?.local?assetURL(v.thumbnail):id?`https://i.ytimg.com/vi/${id}/hqdefault.jpg`:'';
      return `<article class="video-card"><div class="video-stage">${thumb?`<img src="${esc(thumb)}" alt="" loading="lazy">`:''}${player?`<button class="play-video" data-player="${i}" aria-label="Lire ${esc(v.title)}">▶</button>`:`<div class="video-external">${link(v.url,'Voir la vidéo sur '+(v.provider||'le site source'))}</div>`}</div><div class="video-caption"><h4>${esc(v.title||'Vidéo du film')}</h4><p><span class="mini-badge">${esc(v.language||'Langue non vérifiée')}</span> ${esc(v.kind||'Vidéo')}</p>${v.note?`<p>${esc(v.note)}</p>`:''}${link(v.url,'Ouvrir la vidéo dans un nouvel onglet')}</div></article>`;
    }).join('')}</div>`:'<div class="empty-media"><strong>Pas de vidéo vérifiée pour le moment</strong>Aucune bande-annonce ou interview fiable n’a été identifiée dans cette première recherche. Les liens ci-dessous servent à relancer la recherche ; ce ne sont pas des vidéos sélectionnées.</div>';
    return content+`<p class="small-text">Les lecteurs externes se chargent à la lecture. Si un lecteur refuse l’intégration, utilisez le lien sous la vidéo.</p>${link('https://www.youtube.com/results?search_query='+encodeURIComponent(f.title+' '+(f.director||'')+' bande annonce VOSTFR officielle'),'Rechercher une bande-annonce FR / VOSTFR sur YouTube','research-link')}${link('https://www.youtube.com/results?search_query='+encodeURIComponent(f.title+' '+(f.director||'')+' interview'),'Rechercher une interview','research-link')}`;
  }
  function photosPane(f) {
    const photos=(f.photos||[]).filter(p=>assetURL(p));
    if (!photos.length) return '<div class="empty-media"><strong>Les images sont encore à venir</strong>Aucun visuel vérifié pour le moment.</div>';
    const more=f.poster?.moreImages;
    return `<div class="gallery">${photos.map((p,i)=>{
      const title=p.caption||f.title;
      const badge=imageBadge(p);
      const credit=p.credit ? ' · '+esc(p.credit) : '';
      return `<figure><button data-photo="${i}" aria-label="Agrandir : ${esc(title)}"><img src="${esc(assetURL(p))}" alt="${esc(title)}" loading="lazy" data-kind="${esc(p.kind||'photo')}"></button><figcaption>${badge&&p.kind?`<strong>${esc(badge)} · </strong>`:''}${esc(title)}${credit}${p.source?' · '+link(sourceUrl(p.source),'Source'):''}</figcaption></figure>`;
    }).join('')}</div>${more?link(more.url,more.label,'research-link'):''}`;
  }
  function awardsPane(f) {
    return `<div class="details-layout"><div class="details-copy"><h3>Prix reçus</h3>${f.awards?.length?f.awards.map(a=>`<div class="award-item"><strong>✦ ${esc(a.award||a.name||'Récompense')}</strong>${esc(a.festival||'')} ${esc(a.year||'')}<br>${a.source?link(sourceUrl(a.source),'Palmarès / source'):''}</div>`).join(''):empty('Aucun prix vérifié recensé à ce stade. Cela ne signifie pas que le film n’en a reçu aucun.')}<h3>Sélections en festivals</h3>${f.selections?.length?`<ul>${f.selections.map(s=>`<li>${typeof s==='string'?esc(s):esc([s.festival,s.year,s.section||s.selection].filter(Boolean).join(' · '))}${s.source?' · '+link(sourceUrl(s.source),'Source'):''}</li>`).join('')}</ul>`:empty('Aucune sélection vérifiée renseignée.')}<p class="small-text">Une sélection n’est pas un prix. Les palmarès évoluent au fil de la carrière du film.</p></div><div class="details-copy"><h3>Critiques & regards</h3>${f.reviews?.length?`<div class="reviews">${f.reviews.map(r=>`<article class="review">${link(r.url,r.title||'Lire la critique')}<small>${esc(r.outlet||'')}${r.score?' · Note publiée : '+esc(typeof r.score==='object'?JSON.stringify(r.score):r.score):''}</small>${r.note?`<p>${esc(r.note)}</p>`:''}</article>`).join('')}</div>`:empty('Aucune critique de presse vérifiée retenue pour le moment. Les critiques paraissent souvent à l’approche de la sortie.')}<p class="small-text">Les notes de presse, lorsqu’elles sont disponibles, gardent leur échelle d’origine. Votre note de programmation reste indépendante.</p></div></div>`;
  }
  function sourcesPane(f) {
    return `<p class="details-copy">Repérage initial du <strong>31 octobre 2026</strong>. Palmarès enrichis le <strong>1ᵉʳ novembre</strong> ; dernier contrôle des calendriers le <strong>2 novembre 2026</strong>. Les dates sont celles annoncées pour la France ; elles peuvent être modifiées.</p><div class="sources-list">${(f.sources||[]).map(s=>`<div class="source-item">${link(s.url,s.label||'Consulter la source')}<small>${esc(s.role||'Documentation du film')} · ${esc((safeURL(s.url)?new URL(s.url).hostname:'').replace(/^www\./,''))}</small></div>`).join('')}</div>${f.notes?.length?`<div class="details-copy"><h3>Limites et vérifications restantes</h3><ul>${f.notes.map(n=>`<li>${esc(typeof n==='string'?n:JSON.stringify(n))}</li>`).join('')}</ul></div>`:''}<p class="small-text">Les affiches et photographies du film sont créditées dans l’onglet Photos. Les notices des films précédents indiquent leur source et, lorsqu’elles existent, les notes AlloCiné.</p>`;
  }
  function sourceName(url) {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const names = {'allocine.fr':'AlloCiné','themoviedb.org':'TMDB','unifrance.org':'Unifrance','cinergie.be':'Cinergie','offi.fr':'L’Officiel des spectacles','imdb.com':'IMDb','cineuropa.org':'Cineuropa','iffr.com':'IFFR','en.wikipedia.org':'Wikipédia','fr.wikipedia.org':'Wikipédia','festival-cannes.com':'Festival de Cannes','idfa.nl':'IDFA','shortfilmwire.com':'Shortfilmwire'};
    return names[host] || host;
  }
  function previousRatings(ratings) {
    const scoreLine = (name, value) => {
      if (!Number.isFinite(value)) return `<div class="public-rating"><span>${name}</span><small>Indisponible</small></div>`;
      const number = value.toLocaleString('fr-FR', {minimumFractionDigits:1});
      return `<div class="public-rating"><span>${name}</span><span class="stars" style="--fill:${value * 20}%" aria-hidden="true">★★★★★</span><b aria-label="${name} : ${number} sur 5">${number}<small>/5</small></b></div>`;
    };
    if (!ratings?.source) return '<p class="unrated">Notes AlloCiné indisponibles</p>';
    return `<div class="previous-ratings" aria-label="Notes AlloCiné"><strong>Notes AlloCiné</strong>${scoreLine('Presse', ratings.press)}${scoreLine('Spectateurs', ratings.audience)}</div>`;
  }
  function previousCard(p) {
    const image = assetURL(p.poster);
    const cover = image ? `<img loading="lazy" src="${esc(image)}" alt="${esc(p.poster.caption || 'Affiche de '+p.title)}">${p.poster.kind==='director'?'<small>Réalisation · portrait</small>':p.poster.kind==='provisional'?'<small>Visuel du film</small>':''}` : '<small>Visuel non disponible</small>';
    const url = safeURL(p.ratings?.source) || safeURL(p.source);
    return `<article class="previous-film"><div class="previous-cover">${cover}</div><div class="previous-copy"><h4>${esc(p.title)}</h4><p class="previous-meta">${esc([p.year,names(p.genres)].filter(Boolean).join(' · '))}</p><p class="previous-synopsis">${esc(p.synopsis || p.synopsisNote || 'Synopsis non communiqué.')}</p>${previousRatings(p.ratings)}${url?link(url,'Fiche '+sourceName(url),'previous-source'):''}${p.synopsisSource && p.synopsisSource!==url?' · '+link(p.synopsisSource,'Synopsis TMDB','previous-source'):''}</div></article>`;
  }
  function previousPane(f) {
    const v=f.previousWorks || {}, list=v.films || [];
    const sources=(v.sources||[]).map(sourceUrl).filter(safeURL);
    const intro = v.note || (list.length?'Les dernières réalisations documentées '+ofName((v.people||[f.director]).join(' et '))+', de la plus récente à la plus ancienne.':'Aucune réalisation antérieure documentée dans ce repérage.');
    return `<div class="previous-intro"><h3>Films précédents</h3><p>${esc(intro)}</p></div>${list.length?`<div class="previous-grid">${list.map(previousCard).join('')}</div>`:''}${sources.length?`<p class="previous-links">${sources.map(u=>link(u,sourceName(u))).join(' · ')}</p>`:''}`;
  }
  const register=window.FESTIVAL_AWARDS||[];
  const awardedIds=new Set(register.flatMap(f=>f.films.filter(r=>r.status==='eligible').map(r=>r.catalogId)));
  const normRegister=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function registerResults(){
    const festival=$('award-festival').value,status=$('award-status').value,q=normRegister($('award-search').value.trim());
    let total=0;
    const groups=register.map((fest,index)=>({fest,index,rows:fest.films.filter(r=>(festival===''||String(index)===festival)&&(!status||r.status===status)&&(!q||normRegister([r.title,r.originalTitle,r.director,byId.get(r.catalogId)?.title].join(' ')).includes(q))).sort((a,b)=>(a.releaseDate||'9999').localeCompare(b.releaseDate||'9999')||a.title.localeCompare(b.title,'fr'))})).filter(g=>g.rows.length).sort((a,b)=>a.fest.name.localeCompare(b.fest.name,'fr'));
    $('award-results').innerHTML=groups.map(({fest,rows})=>{total+=rows.length;return `<section class="register-fest"><h3>${esc(fest.name)} · ${esc(fest.edition)} <small>${link(fest.source,'Palmarès')}</small></h3><p class="register-scope">${esc(fest.scope)}</p><ul>${rows.map(r=>{const film=r.status==='eligible'&&byId.get(r.catalogId);const tag=r.status==='eligible'?shortDate(r.releaseDate)+' 2027':r.status==='conflict'?'Date à vérifier':r.status==='outside'?(r.releaseDate?fullDate(r.releaseDate):'Hors période'):'Date non établie';return `<li><div><strong>${esc(film?.title||r.title)}</strong>${r.director?' · '+esc(r.director):''} <span class="register-date">${esc(tag)}</span></div><div>${esc(r.awards.join(' · '))}</div><small>${r.awardSource&&r.awardSource!==fest.source?link(r.awardSource,'Source du prix')+' · ':''}${r.releaseSource?link(r.releaseSource,r.releaseDate?'Date française':'Source de repérage'):''}</small>${r.note?`<span class="register-note">${esc(r.note)}</span>`:''}${film?`<button class="outline-button" data-award-film="${esc(film.id)}">Ouvrir la fiche</button>`:''}</li>`}).join('')}</ul></section>`}).join('')||'<p>Aucun lauréat ne correspond à ces critères.</p>';
    $('award-result-count').textContent=plural(total,'entrée film / festival','entrées film / festival')+' · '+plural(groups.length,'palmarès','palmarès');
  }
  function initRegister() {
    $('award-counts').textContent=plural(register.length,'palmarès','palmarès')+' · '+plural(awardedIds.size,'film dans nos dates','films dans nos dates');
    [...register.map((f,i)=>[f,i])].sort((a,b)=>a[0].name.localeCompare(b[0].name,'fr')).forEach(([f,i])=>$('award-festival').add(new Option(f.name+' · '+f.edition,i)));
    $('award-festival').addEventListener('change',registerResults);$('award-status').addEventListener('change',registerResults);$('award-search').addEventListener('input',registerResults);
    $('palmares').addEventListener('toggle',()=>{if($('palmares').open)registerResults()});
    if(location.hash==='#palmares'){$('palmares').open=true;registerResults();}
  }

  const tabs=[['film','Le film'],['previous','Films précédents'],['videos','Vidéos'],['photos','Photos'],['awards','Prix & critiques'],['sources','Sources']];
  function pane(f) {return ({film:filmPane,previous:previousPane,videos:videoPane,photos:photosPane,awards:awardsPane,sources:sourcesPane}[state.tab]||filmPane)(f);}
  function ratingBar(f, score) {
    if (!book.editable) return `<div class="rating-bar"><div class="rating-label"><strong>${score === null ? 'Film non noté' : 'Note de programmation · ' + score + ' / 10'}</strong><small>Lecture seule</small></div></div>`;
    return `<div class="rating-bar"><div class="rating-label"><strong>${score===null?'Votre envie de le programmer':`Votre note : ${score} / 10`}</strong><small>Le classement suit votre note</small></div><div class="rating-buttons" role="group" aria-label="Noter ${esc(f.title)} de 1 à 10">${Array.from({length:10},(_,i)=>`<button class="rate" data-score="${i+1}" aria-pressed="${score===i+1}" aria-label="${i+1} sur 10">${i+1}</button>`).join('')}<button class="clear-rating" data-clear-rating ${score===null?'disabled':''}>Effacer ma note</button></div></div>`;
  }
  function detail(f) {
    const score=C.scoreOf(ratings,f.id);
    return `<section class="film-details" id="film-detail" aria-label="Fiche détaillée de ${esc(f.title)}"><div class="details-header"><div><p class="eyebrow">LE CARNET DU FILM · ${esc(label(f))}</p><h2>${esc(f.title)}</h2>${f.originalTitle&&f.originalTitle!==f.title?`<p class="original-title">${esc(f.originalTitle)}</p>`:''}<p class="summary-line">${esc([f.director?'De '+f.director:null,names(f.genres),durationText(f.duration)].filter(Boolean).join(' · '))}</p></div><button class="close-details" data-close-detail>Fermer ×</button></div><div class="details-tabs" role="tablist" aria-label="Informations du film">${tabs.map(([id,name])=>`<button id="tab-${id}" role="tab" data-tab="${id}" aria-selected="${state.tab===id}" tabindex="${state.tab===id?'0':'-1'}" aria-controls="detail-pane">${name}${id==='videos'&&f.videos?.length?' ('+f.videos.length+')':id==='photos'&&f.photos?.length?' ('+f.photos.length+')':''}</button>`).join('')}</div><div id="detail-pane" role="tabpanel" tabindex="0" aria-labelledby="tab-${state.tab}">${pane(f)}</div>${ratingBar(f, score)}</section>`;
  }
  function layoutOpenDetail() {
    const film = byId.get(state.openId);
    if (!film) return;

    const grid = $('film-grid');
    const cards = Array.from(grid.querySelectorAll('.film-card'));
    const index = cards.indexOf($('card-' + film.id));
    if (index === -1) {
      state.openId = null;
      return;
    }

    const columns = parseInt(getComputedStyle(grid).getPropertyValue('--columns'), 10) || 5;
    const cardRow = Math.floor(index / columns) + 1;
    let panel = $('film-detail');
    if (!panel) {
      const lastCardInRow = cards[Math.min(cardRow * columns, cards.length) - 1];
      lastCardInRow.insertAdjacentHTML('afterend', detail(film));
      panel = $('film-detail');
    }

    // Le plein écran peut redimensionner la fenêtre. Replacer la fiche en CSS
    // conserve le lecteur intégré et sa position de lecture.
    panel.style.gridRowStart = String(cardRow + 1);
  }
  function renderGrid(preserve=false) {
    const offset=preserve?$('film-detail')?.getBoundingClientRect().top:null;
    const selected=C.selectFilms(films,state,ratings);
    const query=state.query.trim();
    $('view-kicker').textContent=query?'RECHERCHE DANS TOUT LE CARNET':state.view==='calendar'?'LE MERCREDI À EXPLORER':state.view==='watch'?'ÉLARGIR LE REPÉRAGE':'CLASSEMENT';
    $('result-title').textContent=query?'Résultats pour « '+query+' »':state.view==='calendar'?fullDate(state.date):state.view==='watch'?'Pistes & dates à vérifier':book.editable?'Mes films notés':'Films notés';
    $('result-subtitle').textContent=query?'Toutes les dates et les pistes, réunies dans une seule recherche.':state.view==='calendar'?'Sorties annoncées en salles en France.':state.view==='watch'?'Films de festivals sans date, annonces contradictoires et reprises à examiner séparément.':'Films classés par note de programmation décroissante.';
    const note=$('context-note');
    note.hidden=false;
    if(query)note.innerHTML='La recherche porte sur <strong>tout le catalogue</strong>. Effacez-la pour retrouver votre mercredi ou votre vue.';
    else if(state.view==='watch')note.innerHTML='<strong>Des pistes, pas encore des avant-premières confirmées.</strong> Les droits France, la date de sortie et la disponibilité restent à vérifier.';
    else if(state.view==='rated')note.innerHTML='<strong>Notes de programmation de 1 à 10.</strong> Les films les mieux notés apparaissent en premier.';
    else if(state.date==='2027-03-03')note.innerHTML='<strong>À programmer avant le 3 mars.</strong> Pour rester en avant-première, ces films peuvent être projetés du 26 février au 2 mars, notamment le premier week-end du festival.';
    else if(state.date>='2027-06-01')note.innerHTML='<strong>Un horizon plus lointain.</strong> Ces sorties sont postérieures au festival, mais la disponibilité d’une copie dès février sera à confirmer avec le distributeur.';
    else note.innerHTML='<strong>Après le festival.</strong> Ces sorties sont compatibles avec une avant-première du 26 février au 7 mars, sous réserve de l’accord du distributeur.';
    $('result-count').textContent=plural(selected.length,'film')+(state.genre?' · '+state.genre:'');
    if(!selected.length){state.openId=null;$('film-grid').innerHTML=`<div class="empty-state"><span class="empty-icon" aria-hidden="true">◌</span><h3>${query||state.genre?'Aucun film pour cette recherche':state.view==='rated'?'Aucun film noté pour le moment':'Le calendrier reste ouvert'}</h3><p>${query||state.genre?'Essayez un titre, un nom de cinéaste ou un autre genre.':state.view==='rated'?(book.editable?'Ouvrez une fiche et attribuez une note de 1 à 10.':'Les films apparaîtront ici dès la publication des premières notes.'):'Aucune sortie suffisamment vérifiée n’est encore renseignée pour ce mercredi. Les annonces s’ajouteront au fil des prochains repérages.'}</p>${state.view==='rated'?'<button class="outline-button" data-view="calendar">Explorer les sorties</button>':query||state.genre?'<button class="outline-button" data-reset-filter>Effacer les filtres</button>':link('https://www.allocine.fr/film/agenda/sem-'+state.date+'/','Consulter l’agenda AlloCiné de cette semaine')}</div>`;}
    else{$('film-grid').innerHTML=selected.map(card).join('');layoutOpenDetail();}
    if(offset!==null&&$('film-detail')){const delta=$('film-detail').getBoundingClientRect().top-offset;if(Math.abs(delta)>1)window.scrollBy({top:delta,behavior:'instant'});}
    $('live-status').textContent=plural(selected.length,'film')+' affichés.';
  }
  function render(preserve=false){counts();calendar();renderGrid(preserve);}
  function goDate(date){if(!C.dates.includes(date))return;state.date=date;state.view='calendar';state.query='';$('search').value='';state.openId=null;render();}
  function setView(view){state.view=view;state.openId=null;state.query='';$('search').value='';render();}
  function showMethod(){ $('methodology').hidden=false;$('methodology').scrollIntoView({behavior:'smooth',block:'start'});}
  document.addEventListener('click',event=>{
    const btn=event.target.closest('button');if(!btn)return;
    if(btn.dataset.awardFilm){const f=byId.get(btn.dataset.awardFilm);if(!f)return;$('palmares').open=false;state.genre='';$('genre').value='';goDate(f.releaseDate);state.openId=f.id;state.tab='awards';renderGrid();requestAnimationFrame(()=>{$('tab-awards')?.focus({preventScroll:true});$('film-detail')?.scrollIntoView({block:'start'});});return;}
    if(btn.dataset.view){setView(btn.dataset.view);return;}
    if(btn.dataset.date){goDate(btn.dataset.date);return;}
    if(btn.dataset.month){goDate(C.dates.find(d=>d.slice(5,7)===btn.dataset.month));return;}
    if(btn.dataset.film){const wasOpen=state.openId===btn.dataset.film;state.openId=wasOpen?null:btn.dataset.film;state.tab='film';renderGrid();if(!wasOpen)requestAnimationFrame(()=>$('film-detail')?.scrollIntoView({behavior:'smooth',block:'start'}));else document.querySelector(`[data-film="${CSS.escape(btn.dataset.film)}"]`)?.focus({preventScroll:true});return;}
    if(btn.hasAttribute('data-close-detail')){const id=state.openId;state.openId=null;renderGrid();const cardBtn=document.querySelector(`[data-film="${CSS.escape(id)}"]`);cardBtn?.focus({preventScroll:true});cardBtn?.scrollIntoView({behavior:'smooth',block:'nearest'});return;}
    if(btn.dataset.tab){state.tab=btn.dataset.tab;document.querySelectorAll('[data-tab]').forEach(t=>{t.setAttribute('aria-selected',t===btn);t.tabIndex=t===btn?0:-1;});$('detail-pane').innerHTML=pane(byId.get(state.openId));$('detail-pane').setAttribute('aria-labelledby','tab-'+state.tab);return;}
    if(book.editable && btn.dataset.score){const id=state.openId;const score=Number(btn.dataset.score);book.set(id,score);document.querySelector(`[data-score="${score}"]`)?.focus({preventScroll:true});$('live-status').textContent=`${byId.get(id).title} : ${score} sur 10. Classement mis à jour.`;return;}
    if(book.editable && btn.hasAttribute('data-clear-rating')){book.set(state.openId,null);notify('Note effacée.');return;}
    if(btn.hasAttribute('data-reset-filter')){state.query='';state.genre='';$('search').value='';$('genre').value='';renderGrid();return;}
    if(btn.hasAttribute('data-player')){const f=byId.get(state.openId);const video=f.videos.filter(v=>safeURL(v.url))[Number(btn.dataset.player)];const iframe=document.createElement('iframe');iframe.src=playerURL(video);iframe.title=video.title||'Vidéo de '+f.title;iframe.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';iframe.referrerPolicy='strict-origin-when-cross-origin';iframe.allowFullscreen=true;btn.closest('.video-stage').replaceChildren(iframe);return;}
    if(btn.hasAttribute('data-photo')){const f=byId.get(state.openId);const p=(f.photos||[]).filter(p=>assetURL(p))[Number(btn.dataset.photo)];$('large-photo').src=assetURL(p);$('large-photo').alt=p.caption||f.title;$('photo-caption').textContent=[p.caption||f.title,p.credit].filter(Boolean).join(' · ');$('photo-dialog').showModal();}
  });
  document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement){const img=event.target;if(img.dataset.poster){img.hidden=true;const fallback=img.parentElement.querySelector('.poster-fallback');if(fallback)fallback.hidden=false;const badge=img.parentElement.querySelector('.media-kind');if(badge)badge.hidden=true;}else if(img.closest('.video-stage'))img.hidden=true;else img.alt='Image indisponible · '+img.alt;}},true);
  $('previous-week').addEventListener('click',()=>goDate(C.dates[C.dates.indexOf(state.date)-1]));
  $('next-week').addEventListener('click',()=>goDate(C.dates[C.dates.indexOf(state.date)+1]));
  $('search').addEventListener('input',e=>{state.query=e.target.value;state.openId=null;renderGrid();});
  $('genre').addEventListener('change',e=>{state.genre=e.target.value;state.openId=null;renderGrid();});
  $('method-button').addEventListener('click',showMethod);
  $('close-method').addEventListener('click',()=>{$('methodology').hidden=true;$('method-button').focus();});
  $('close-photo').addEventListener('click',()=>$('photo-dialog').close());
  $('photo-dialog').addEventListener('click',e=>{if(e.target===$('photo-dialog'))$('photo-dialog').close();});
  document.addEventListener('keydown',e=>{
    if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('search').focus();}
    if(e.target.matches('[role=tab]')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...document.querySelectorAll('[role=tab]')];const i=buttons.indexOf(e.target);const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();}
  });
  $('export-button').addEventListener('click',()=>{
    const payload={format:'cine-carbonne-ratings',version:1,festival:2027,exportedAt:new Date().toISOString(),ratings,titles:Object.fromEntries(films.filter(f=>ratings[f.id]).map(f=>[f.id,f.title]))};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='cine-carbonne-notes-'+new Date().toLocaleDateString('en-CA')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Sauvegarde des notes téléchargée.');
  });
  $('import-button').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!book.editable||!file)return;try{if(file.size>2000000)throw new Error('Le fichier est trop volumineux.');const result=C.mergeRatings(ratings,JSON.parse(await file.text()),new Set(byId.keys()));book.apply(result.ratings);notify('Sauvegarde fusionnée. Les décisions plus récentes ont été conservées.');}catch(error){notify('Import impossible : '+error.message);}finally{e.target.value='';}});
  window.addEventListener('resize', layoutOpenDetail);
  initRegister();
  const genres=[...new Set(films.flatMap(f=>f.genres||[]))].sort((a,b)=>a.localeCompare(b,'fr'));
  $('genre').insertAdjacentHTML('beforeend',genres.map(g=>`<option>${esc(g)}</option>`).join(''));
  const coverage=catalog.meta.coverage||[];
  $('research-coverage').innerHTML=`<details class="coverage-list"><summary>Calendriers consultés, festivals et limites de la recherche</summary><ul><li>${link('https://www.allocine.fr/film/agenda/','Agenda France AlloCiné')} : semaines de mars à juin 2027, complétées par les fiches des films.</li><li>${link('https://ecran-total.fr/calendrier/','Calendrier professionnel Écran total')} et sites des distributeurs pour les recoupements.</li><li>Les listes Cinefil et d’autres agrégateurs servent au repérage ; les dates étrangères et les fiches douteuses ne sont pas reprises comme annonces françaises.</li>${coverage.map(c=>`<li>${typeof c==='string'?esc(c):esc(c.summary||c.note||c.name||JSON.stringify(c))}${c.url?' · '+link(c.url,'Source'):''}</li>`).join('')}</ul><p>Les sorties nouvelles, les reports et les médias pourront être ajoutés aux données sans modifier vos notes. Cette version ne prétend pas à l’exhaustivité des annonces ni des palmarès.</p></details>`;
  function openFromLink(){
    if(location.hash==='#palmares'){$('palmares').open=true;return;}
    const match=/^#film\/([a-z0-9-]+)\/(previous|awards|film)$/.exec(location.hash),f=match&&byId.get(match[1]);
    if(!f)return;
    $('palmares').open=false;state.genre='';$('genre').value='';state.query='';$('search').value='';
    state.view=C.isCalendar(f)?'calendar':'watch';if(C.isCalendar(f))state.date=f.releaseDate;
    state.openId=f.id;state.tab=match[2];render();
    requestAnimationFrame(()=>$('film-detail')?.scrollIntoView({block:'start'}));
  }
  book.start();render();openFromLink();window.addEventListener('hashchange',openFromLink);
})();
