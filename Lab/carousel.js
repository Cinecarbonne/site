
(function () {
  // sizing
  function applySizing() {
    var w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    var baseStrip = Math.max(290, Math.min(460, Math.round(230 + 0.19 * w)));
    var stripH = baseStrip - 20;
    var capH = 40;
    var vignetteH = Math.round(baseStrip * 23 / 35);
    var posterH = Math.max(120, vignetteH - capH);
    var colW = Math.round(posterH * 2 / 3);
    var root = document.documentElement;
    root.style.setProperty('--stripH', stripH + 'px');
    root.style.setProperty('--vignetteH', vignetteH + 'px');
    root.style.setProperty('--posterH', posterH + 'px');
    root.style.setProperty('--colW', colW + 'px');
    root.style.setProperty('--capH', capH + 'px');
  }
  applySizing();
  window.addEventListener('resize', applySizing);

  function pad2(n) { n = parseInt(n, 10); return (n < 10 ? '0' : '') + n; }
  function formatDayParts(dateStr) {
    if (!dateStr) return { abbr: '', date: '' };
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return { abbr: '', date: dateStr };
    var jours = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
    return { abbr: jours[d.getDay()], date: pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) };
  }

  var rail = document.getElementById('rail'),
    strip = document.getElementById('strip'),
    panel = document.getElementById('panel'),
    pTitle = document.getElementById('p-title'),
    pReal = document.getElementById('p-real'),
    pCast = document.getElementById('p-cast'),
    pInfo = document.getElementById('p-info'),
    pGenres = document.getElementById('p-genres'),
    pSynopsis = document.getElementById('p-synopsis'),
    pBackdropTop = document.getElementById('p-backdropTop'),
    pTrailer = document.getElementById('p-trailer'),
    todayBtn = document.getElementById('todayBtn'),
    thumbStrip = document.getElementById('thumb-strip'),
    pChipsTop = document.getElementById('p-chipsTop'),
    pPrix = document.getElementById('p-prix');

  function hidePanel() {
    panel.classList.remove('visible');
    pTitle.textContent = '';
    pReal.textContent = '';
    pCast.textContent = '';
    pInfo.textContent = '';
    pGenres.textContent = '';
    pSynopsis.textContent = '';
    pBackdropTop.removeAttribute('src');
  }

  function getAllocineURL(s) {
    return s.allocine_url || s.AllocineURL || s.allocine || s.url_allocine || s.AlloCine || s.allocineUrl || '';
  }

  function backdropSrcset(u) {
    if (!u) return "";
    var w300 = u.replace('/w780/', '/w300/');
    var w1280 = u.replace('/w780/', '/w1280/');
    return w300 + ' 300w, ' + u + ' 780w, ' + w1280 + ' 1280w';
  }
  function backdropSizes() {
    return '(max-width: 860px) 100vw, 480px';
  }

  function makeSpecialChips(s) {
    var labels = [];
    var txt = ((s.categorie || '') + ' ' + (s.commentaire || '')).toLowerCase();
    var map = [
      { k: 'ciné goûter', label: 'Ciné Goûter' },
      { k: 'cine gouter', label: 'Ciné Goûter' },
      { k: 'ciné jeunes', label: 'Ciné Jeunes' },
      { k: 'cine jeunes', label: 'Ciné Jeunes' },
      { k: 'ephad', label: 'Séance EPHAD HANDI' },
      { k: 'handi', label: 'Séance EPHAD HANDI' },
      { k: 'ciné documentaire', label: 'Ciné Documentaire' },
      { k: 'cine documentaire', label: 'Ciné Documentaire' },
      { k: 'ciné club', label: 'Ciné Club' },
      { k: 'cine club', label: 'Ciné Club' },
      { k: 'ciné discussion', label: 'Ciné Discussion' },
      { k: 'cine discussion', label: 'Ciné Discussion' }
    ];
    map.forEach(function (m) { if (txt.indexOf(m.k) >= 0 && labels.indexOf(m.label) === -1) labels.push(m.label); });
    return labels;
  }

  // convertit date+heure (format JSON uniforme) en timestamp local
  function seanceTimestamp(s) {
    if (!s || !s.date || !s.heure) return NaN;
    var datePart = s.date.trim();
    var timePart = s.heure.trim();
    var y = parseInt(datePart.slice(0, 4), 10);
    var m = parseInt(datePart.slice(5, 7), 10) - 1;
    var d = parseInt(datePart.slice(8, 10), 10);
    var hh = parseInt(timePart.slice(0, 2), 10) || 0;
    var mm = parseInt(timePart.slice(3, 5), 10) || 0;
    return new Date(y, m, d, hh, mm, 0, 0).getTime();
  }

  function openPanel(s) {
    if (!s) return;
    pTitle.textContent = s.titre || 'Titre inconnu';
    pReal.textContent = s.realisateur || '';
    pCast.textContent = s.acteurs_principaux || '';

    var infoParts = [];
    if (s.version) infoParts.push(s.version);
    if (s.annee) infoParts.push(s.annee);
    if (s.pays) infoParts.push(s.pays);
    if (s.duree_min) {
      var d = parseInt(s.duree_min, 10);
      if (!isNaN(d)) {
        if (d >= 60) {
          var h = Math.floor(d / 60);
          var m = d % 60;
          var txt = h + 'h' + (m > 0 ? String(m).padStart(2, '0') : '00');
          infoParts.push(txt);
        } else {
          infoParts.push(d + ' min');
        }
      }
    };
    pInfo.textContent = infoParts.join(' / ');

    pGenres.textContent = s.genres || '';

    // synopsis
    pSynopsis.textContent = s.synopsis || '';

    // lien Allociné
    var aUrl = getAllocineURL(s);
    if (aUrl && typeof aUrl === 'string' && aUrl.trim() !== '') {
      pSynopsis.appendChild(document.createElement('br'));
      pSynopsis.appendChild(document.createElement('br'));
      var a = document.createElement('a');
      var titre = (s.titre || 'Fiche');
      a.textContent = '"' + titre + '" sur Allociné';
      a.href = aUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.className = 'allocineLink';
      pSynopsis.appendChild(a);
    }

    // chips
    if (pChipsTop) {
      pChipsTop.innerHTML = '';
      var labels = makeSpecialChips(s);
      labels.forEach(function (label) {
        var chip = document.createElement('div');
        chip.className = 'chip';
        chip.textContent = label;
        pChipsTop.appendChild(chip);
      });
      var c = (s.commentaire || '').trim();
      if (c) {
        var com = document.createElement('div');
        com.className = 'chip';
        com.textContent = c;
        pChipsTop.appendChild(com);
      }
      var tar = (s.tarif || '').trim();
      if (tar) {
        var t = document.createElement('div');
        t.className = 'chip';
        t.textContent = tar;
        pChipsTop.appendChild(t);
      }
    }

    // prix
    if (pPrix) {
      var pr = (s.prix || '').trim();
      if (pr) { pPrix.textContent = pr; pPrix.style.display = 'block'; }
      else { pPrix.style.display = 'none'; }
    }

    // image principale
    var best = (s.backdrop_url || s.affiche_url || '');
    pBackdropTop.src = best;
    pBackdropTop.style.display = best ? 'block' : 'none';
    if (best) {
      pBackdropTop.srcset = backdropSrcset(best);
      pBackdropTop.sizes = backdropSizes();
    }

    // GALERIE — affichage adapté au nombre d’images
    if (thumbStrip) {
      while (thumbStrip.firstChild) thumbStrip.removeChild(thumbStrip.firstChild);

      var urls = [];
      function pushU(u) { if (u && urls.indexOf(u) === -1) urls.push(u); }

      // image principale d'abord
      pushU(s.backdrop_url);
      // puis les autres
      if (Array.isArray(s.backdrops)) s.backdrops.forEach(pushU);

      // max 5
      urls = urls.slice(0, 5);

      // 0 ou 1 -> pas de galerie
      if (urls.length <= 1) {
        thumbStrip.style.display = 'none';
        thumbStrip.className = 'thumb-strip';
      } else {
        thumbStrip.style.display = 'grid';
        // on remet la classe de base puis on ajoute le modificateur
        thumbStrip.className = 'thumb-strip thumb-strip--' + urls.length;

        urls.forEach(function (u, i) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'thumb';
          btn.setAttribute('role', 'listitem');
          btn.setAttribute('aria-label', 'Image ' + (i + 1) + '/' + urls.length);
          var img = document.createElement('img');
          img.src = String(u).replace('/w780/', '/w300/');
          img.loading = 'lazy';
          img.decoding = 'async';
          btn.appendChild(img);
          btn.addEventListener('click', function () {
            pBackdropTop.src = u;
            pBackdropTop.srcset = backdropSrcset(u);
            pBackdropTop.sizes = backdropSizes();
            var kids = thumbStrip.querySelectorAll('.thumb');
            kids.forEach(function (k, j) { k.setAttribute('aria-current', j === i ? 'true' : 'false'); });
          });
          if (i === 0) btn.setAttribute('aria-current', 'true');
          thumbStrip.appendChild(btn);
        });
      }
    }

    // trailer
    var embed = (function (url) {
      if (!url) return null;
      var m1 = /v=([a-zA-Z0-9_-]{6,})/.exec(url);
      var m2 = /youtu\.be\/([a-zA-Z0-9_-]{6,})/.exec(url);
      var k = (m1 && m1[1]) || (m2 && m2[1]);
      if (!k) return null;
      return 'https://www.youtube.com/embed/' + k;
    })(s.trailer_url);
    pTrailer.innerHTML = embed ? '<iframe width="100%" height="420" src="' + embed + '" frameborder="0" allowfullscreen></iframe>' : '';

    requestAnimationFrame(function () { panel.classList.add('visible'); });
  }

  function renderColumn(s) {
    var col = document.createElement('button');
    col.type = 'button'; col.className = 'col'; col.setAttribute('aria-label', s.titre || 'Séance');
    var card = document.createElement('span'); card.className = 'card';

    var cap = document.createElement('div'); cap.className = 'cap';
    var dayWrap = document.createElement('div'); dayWrap.className = 'day';
    var parts = formatDayParts(s.date);
    var abbr = document.createElement('span'); abbr.className = 'abbr'; abbr.textContent = parts.abbr;
    var date = document.createElement('span'); date.className = 'date'; date.textContent = parts.date;
    dayWrap.appendChild(abbr); dayWrap.appendChild(date);
    cap.appendChild(dayWrap);

    var time = document.createElement('div'); time.className = 'time'; time.textContent = s.heure || ''; cap.appendChild(time);

    var poster = document.createElement('img'); poster.className = 'poster'; poster.src = s.affiche_url || ''; poster.alt = 'Affiche — ' + (s.titre || ''); poster.loading = 'lazy';

    card.appendChild(cap); card.appendChild(poster); col.appendChild(card);
    col.addEventListener('click', function () { openPanel(s); });
    return col;
  }

  // RENDER LIST filtré + trié
  function renderList(list) {
    var items = Array.isArray(list) ? list : [];
    var now = Date.now();
    var margeMs = 2 * 60 * 60 * 1000; // 2h

    var futurs = items.filter(function (s) {
      if (!s.heure || String(s.heure).trim() === "") return false;
      var ts = seanceTimestamp(s);
      if (isNaN(ts)) return false;
      return ts >= (now - margeMs);
    });

    futurs.sort(function (a, b) {
      return seanceTimestamp(a) - seanceTimestamp(b);
    });

    strip.innerHTML = '';
    hidePanel();

    futurs.forEach(function (s) {
      strip.appendChild(renderColumn(s));
    });

    if (futurs.length > 0) {
      openPanel(futurs[0]);
    }
  }

  function loadJSON() {
    var url = './programme.json';
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (t) { return JSON.parse(t); })
      .then(function (list) {
        window.films = list;
        renderList(window.films);
      })
      .catch(function (e) { console.warn('Échec chargement JSON:', e.message); });
  }
  window.addEventListener('load', loadJSON);
  // auto-refresh toutes les 30 minutes
  setInterval(function () {
    loadJSON();
  }, 30 * 60 * 1000);


  function selView(n, litag) {
    var PrgView = "none";
    var archView = "none";
    console.log("selView: " + n);

    switch (n) {
      case 1: // Programme
        PrgView = "inline";
        break;
      case 2: // PDF
      case 3: // Prochainement (pour l'instant même panel)
      case 4: // Archives (idem)
        archView = "inline";
        break;
      default:
        break;
    }

    document.getElementById("program_panel").style.display = PrgView;
    document.getElementById("archives_panel").style.display = archView;

    var tabs = document.getElementById("tabs");
    var ca = Array.prototype.slice.call(tabs.querySelectorAll("li"));
    ca.forEach(function (elem) {
      elem.className = "";
    });
    litag.className = "selected";
  }

  // drag scroll + flèches
  (function () {
    console.log("main functiion");
    var isDown = false, startX = 0, startScroll = 0;
    var leftBtn = document.getElementById('leftBtn'), rightBtn = document.getElementById('rightBtn');
    var li_prog  = document.getElementById("li_prog"),
        li_pdf   = document.getElementById("li_pdf"),
        li_proch = document.getElementById("li_proch"),
        li_arch  = document.getElementById("li_arch");

    rail.addEventListener('mousedown', function (e) { isDown = true; startX = e.pageX; startScroll = rail.scrollLeft; e.preventDefault(); });
    window.addEventListener('mouseup', function () { isDown = false; });
    window.addEventListener('mousemove', function (e) { if (!isDown) return; rail.scrollLeft = startScroll - (e.pageX - startX); });
    rail.addEventListener('touchstart', function (e) { isDown = true; startX = e.touches[0].pageX; startScroll = rail.scrollLeft; }, { passive: true });
    rail.addEventListener('touchend', function () { isDown = false; });
    rail.addEventListener('touchmove', function (e) { if (!isDown) return; rail.scrollLeft = startScroll - (e.touches[0].pageX - startX); }, { passive: true });
    var step = function () {
      var colW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--colW'), 10) || 220;
      var gap = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gap'), 10) || 12; return colW + gap;
    };
    leftBtn.addEventListener('click', function () { rail.scrollBy({ left: -step(), behavior: 'smooth' }); });
    rightBtn.addEventListener('click', function () { rail.scrollBy({ left: step(), behavior: 'smooth' }); });
    todayBtn.addEventListener('click', function () { rail.scrollTo({ left: 0, behavior: 'smooth' }); });

    // Onglets
    li_prog.addEventListener("click",  function () { selView(1, li_prog);  });
    li_pdf.addEventListener("click",   function () { selView(2, li_pdf);   });
    li_proch.addEventListener("click", function () { selView(3, li_proch); });
    li_arch.addEventListener("click",  function () { selView(4, li_arch);  });

    // Au chargement : on masque le panel PDF/archives
    document.getElementById("archives_panel").style.display = 'none';
  })();
  