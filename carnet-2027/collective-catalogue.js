(() => {
  const observer=new MutationObserver(()=>{
    const detail=document.querySelector('#film-detail'),bar=detail?.querySelector('.rating-bar');
    if(!bar||bar.querySelector('.vote-link'))return;
    const id=location.hash.match(/^#film\/([^/]+)/)?.[1];if(!id)return;
    bar.replaceChildren();
    const text=document.createElement('p');text.textContent='Votre avis se donne dans le bulletin collectif.';
    const a=document.createElement('a');a.className='vote-link collective-detail-link';a.href='vote.html?film='+encodeURIComponent(decodeURIComponent(id));a.textContent='Retrouver ce film dans mon bulletin →';bar.append(text,a);
  });
  observer.observe(document.getElementById('film-grid'),{childList:true,subtree:true});
})();
