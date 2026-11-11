(function(root) {
  'use strict';
  const dates = [];
  for (let t = Date.UTC(2027,2,3); t <= Date.UTC(2027,5,30); t += 7*86400000) dates.push(new Date(t).toISOString().slice(0,10));
  const normalize = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const scoreOf = (ratings,id) => Number.isInteger(ratings[id]?.score) && ratings[id].score >= 1 && ratings[id].score <= 10 ? ratings[id].score : null;
  const isCalendar = f => f.releaseStatus === 'announced' && dates.includes(f.releaseDate) && !f.isReissue;
  const sortFilms = (films,ratings) => [...films].sort((a,b) => (scoreOf(ratings,b.id)||0) - (scoreOf(ratings,a.id)||0) || String(a.releaseDate||'9999').localeCompare(b.releaseDate||'9999') || a.title.localeCompare(b.title,'fr'));
  function selectFilms(films,state,ratings) {
    const query = normalize(state.query).trim();
    return sortFilms(films.filter(f => {
      const target = query ? true : state.view === 'calendar' ? isCalendar(f) && f.releaseDate === state.date : state.view === 'watch' ? !isCalendar(f) : scoreOf(ratings,f.id) !== null;
      const words = normalize([f.title,f.originalTitle,f.director,(f.genres||[]).join(' '),f.distributor?.name,(f.countries||[]).join(' ')].join(' '));
      return target && (!query || query.split(/\s+/).every(w=>words.includes(w))) && (!state.genre || (f.genres||[]).includes(state.genre));
    }),ratings);
  }
  function mergeRatings(existing,incoming,validIds) {
    if (!incoming || incoming.format !== 'cine-carbonne-ratings' || incoming.version !== 1 || typeof incoming.ratings !== 'object' || !incoming.ratings || Array.isArray(incoming.ratings)) throw new Error('Ce fichier n’est pas une sauvegarde de notes Ciné Carbonne.');
    const result = {...existing}; let count = 0;
    for (const [id,item] of Object.entries(incoming.ratings)) {
      if (!validIds.has(id)) continue;
      if (!item || !Number.isInteger(item.score) || item.score < 1 || item.score > 10 || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error('Une note du fichier est invalide. Aucune modification effectuée.');
      if (!result[id] || Date.parse(item.updatedAt) > Date.parse(result[id].updatedAt || 0)) { result[id] = {score:item.score,updatedAt:item.updatedAt}; count++; }
    }
    return {ratings:result,count};
  }
  const api = {dates,normalize,scoreOf,isCalendar,sortFilms,selectFilms,mergeRatings};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CatalogCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
