
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
    pRecomp = document.getElementById('p-recompenses'),
    calendarBtn = document.getElementById('calendarBtn'),
    calendarOverlay = document.getElementById('calendarOverlay'),
    calendarGrid = document.getElementById('calendarGrid'),
    calTitle = document.getElementById('calTitle'),
    calPrev = document.getElementById('calPrev'),
    calNext = document.getElementById('calNext');

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

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function toISODate(y, m, d) {
    var mm = (m < 10 ? '0' + m : '' + m);
    var dd = (d < 10 ? '0' + d : '' + d);
    return y + '-' + mm + '-' + dd;
  }

  function buildDateIndexMap(list) {
    var map = {};
    (Array.isArray(list) ? list : []).forEach(function (item, idx) {
      if (item && item.date && map[item.date] === undefined) {
        map[item.date] = idx;
      }
    });
    return map;
  }

  function wrapTrailer(inner) {
    return '<div class="trailer-frame">' + inner + '</div>';
  }

  function trailerButtonHtml(src, thumbUrl) {
    var style = '';
    if (thumbUrl) {
      var safe = String(thumbUrl).replace(/'/g, '%27');
      style = ' style="background-image:url(\'' + safe + '\')"';
    }
    return wrapTrailer('<button class="trailer-play"' + style + ' data-src="' + src + '" type="button" aria-label="Lire la bande-annonce">' +
      '<span class="trailer-play-icon" aria-hidden="true"></span>' +
      '<span class="trailer-play-label">Lire la bande-annonce</span>' +
      '</button>');
  }

  function wireTrailerDeferred(container) {
    if (!container) return;
    var btn = container.querySelector('.trailer-play[data-src]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var src = btn.getAttribute('data-src') || '';
      if (!src) return;
      var frame = btn.parentNode;
      if (!frame) return;
      var iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
      frame.innerHTML = '';
      frame.appendChild(iframe);
    }, { once: true });
  }

  function setQueryParams(url, params) {
    if (!url) return url;
    var hash = '';
    var base = url;
    var hashIndex = url.indexOf('#');
    if (hashIndex >= 0) {
      hash = url.slice(hashIndex);
      base = url.slice(0, hashIndex);
    }
    var parts = base.split('?');
    var path = parts[0];
    var query = parts[1] || '';
    var map = {};
    if (query) {
      query.split('&').forEach(function (pair) {
        if (!pair) return;
        var kv = pair.split('=');
        var key = decodeURIComponent(kv[0] || '').trim();
        if (!key) return;
        map[key] = decodeURIComponent(kv[1] || '');
      });
    }
    Object.keys(params || {}).forEach(function (key) {
      map[key] = String(params[key]);
    });
    var qs = Object.keys(map).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(map[key]);
    }).join('&');
    return path + (qs ? '?' + qs : '') + hash;
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

    // recompenses
    if (pRecomp) {
      var rc = (s.recompenses || '').trim();
      if (rc) { pRecomp.textContent = rc; pRecomp.style.display = 'block'; }
      else { pRecomp.style.display = 'none'; }
    }

    // image principale
    var backdrops = Array.isArray(s.backdrops) ? s.backdrops : [];
    var best = (backdrops[0] || s.affiche_url || '');
    var trailerFallback = best || '';
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
      function imgKey(u) {
        if (!u) return '';
        var base = u.split('?')[0];
        var parts = base.split('/');
        return parts[parts.length - 1].toLowerCase();
      }
      var posterKey = imgKey(s.affiche_url || '');
      function pushU(u) {
        if (!u) return;
        if (posterKey && imgKey(u) === posterKey) return;
        if (urls.indexOf(u) === -1) urls.push(u);
      }

      // images du JSON (premiere = image principale)
      backdrops.forEach(pushU);

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
    var trailerHtml = (function (url) {
      if (!url) return '';
      // MP4 direct
      if (/\.mp4(\?|$)/i.test(url)) {
        return wrapTrailer('<video controls preload="none">' +
               '<source src="' + url + '" type="video/mp4">' +
               '</video>');
      }
      // Allocine player (deferred to avoid autoplay)
      if (/player\.allocine\.fr/i.test(url) || /allocine\.fr\/video\/player_gen_cmedia/i.test(url)) {
        var aSrc = setQueryParams(url, { autoplay: 0, autostart: 0, autoStart: 0 });
        return trailerButtonHtml(aSrc, trailerFallback);
      }
      // Dailymotion (watch or embed)
      var dm = /dailymotion\.com\/video\/([a-zA-Z0-9]+)/.exec(url) ||
               /dailymotion\.com\/embed\/video\/([a-zA-Z0-9]+)/.exec(url);
      if (dm && dm[1]) {
        var dSrc = setQueryParams('https://www.dailymotion.com/embed/video/' + dm[1], {
          autoplay: 1,
          mute: 0,
          start: 0,
          'queue-enable': 0,
          'queue-autoplay': 0,
          'ui-start-screen-info': 1
        });
        var dThumb = 'https://www.dailymotion.com/thumbnail/video/' + dm[1];
        return trailerButtonHtml(dSrc, dThumb);
      }
      // YouTube (watch or short)
      var m1 = /v=([a-zA-Z0-9_-]{6,})/.exec(url);
      var m2 = /youtu\.be\/([a-zA-Z0-9_-]{6,})/.exec(url);
      var k = (m1 && m1[1]) || (m2 && m2[1]);
      if (!k) return '';
      var ySrc = setQueryParams('https://www.youtube.com/embed/' + k, { autoplay: 0, mute: 0 });
      return wrapTrailer('<iframe src="' + ySrc + '" frameborder="0" allowfullscreen></iframe>');
    })(s.trailer_url);
    pTrailer.innerHTML = trailerHtml || '';
    wireTrailerDeferred(pTrailer);

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



  function updateCalendarData(list) {
    var map = buildDateIndexMap(list);
    window._futursList = list;
    window._dateIndexMap = map;
    window._availableDates = new Set(Object.keys(map));
  }

  function findIndexForDateOrNext(dateStr) {
    var map = window._dateIndexMap || {};
    if (map[dateStr] !== undefined) return map[dateStr];
    var list = window._futursList || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].date && list[i].date >= dateStr) return i;
    }
    return -1;
  }

  function scrollToFilmIndex(idx) {
    var list = window._futursList || [];
    if (idx < 0 || idx >= list.length) return;
    var colW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--colW'), 10) || 220;
    var gap = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gap'), 10) || 12;
    rail.scrollTo({ left: idx * (colW + gap), behavior: 'smooth' });
    openPanel(list[idx]);
  }

  var calState = { year: null, month: null };

  function renderCalendar() {
    if (!calendarGrid || !calTitle) return;
    var today = startOfDay(new Date());
    var year = calState.year;
    var month = calState.month;
    if (year === null || month === null) {
      year = today.getFullYear();
      month = today.getMonth();
      calState.year = year;
      calState.month = month;
    }

    var monthNames = [
      'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'
    ];
    calTitle.textContent = monthNames[month] + ' ' + year;

    var first = new Date(year, month, 1);
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var startOffset = (first.getDay() + 6) % 7;
    var available = window._availableDates || new Set();

    calendarGrid.innerHTML = '';
    var frag = document.createDocumentFragment();

    var week = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    week.forEach(function (label) {
      var head = document.createElement('span');
      head.className = 'cal-dow';
      head.textContent = label;
      frag.appendChild(head);
    });

    for (var i = 0; i < startOffset; i++) {
      var empty = document.createElement('span');
      empty.className = 'cal-day cal-empty';
      frag.appendChild(empty);
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = toISODate(year, month + 1, day);
      var dateObj = new Date(year, month, day);
      var isPast = dateObj < today;
      var hasFilm = available.has(dateStr);
      var isActive = !isPast && hasFilm;

      var cell = document.createElement(isActive ? 'button' : 'span');
      cell.className = 'cal-day ' + (isActive ? 'is-active' : 'is-disabled');
      cell.textContent = String(day);
      if (isActive) {
        cell.type = 'button';
        (function (iso) {
          cell.addEventListener('click', function () {
            var idx = findIndexForDateOrNext(iso);
            scrollToFilmIndex(idx);
            closeCalendar();
          });
        })(dateStr);
      }
      frag.appendChild(cell);
    }

    calendarGrid.appendChild(frag);
  }

  function shiftCalendarMonth(delta) {
    var year = calState.year;
    var month = calState.month;
    if (year === null || month === null) {
      var now = new Date();
      year = now.getFullYear();
      month = now.getMonth();
    }
    month += delta;
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }
    calState.year = year;
    calState.month = month;
    renderCalendar();
  }

  function openCalendar() {
    if (!calendarOverlay) return;
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var today = startOfDay(now);
    var available = window._availableDates || new Set();
    var remaining = 0;
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    for (var day = today.getDate(); day <= daysInMonth; day++) {
      var iso = toISODate(year, month + 1, day);
      if (available.has(iso)) remaining++;
    }
    if (remaining <= 2) {
      month += 1;
      if (month > 11) { month = 0; year += 1; }
    }
    calState.year = year;
    calState.month = month;
    calendarOverlay.classList.add('open');
    calendarOverlay.setAttribute('aria-hidden', 'false');
    renderCalendar();
  }

  function closeCalendar() {
    if (!calendarOverlay) return;
    calendarOverlay.classList.remove('open');
    calendarOverlay.setAttribute('aria-hidden', 'true');
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

    updateCalendarData(futurs);
    if (calendarOverlay && calendarOverlay.classList.contains('open')) {
      renderCalendar();
    }

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

  // ===================== ONGLET PDF : helpers =====================

  function todayISO() {
    var d = new Date();
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    var mm = (m < 10 ? '0' + m : '' + m);
    var dd = (day < 10 ? '0' + day : '' + day);
    return y + '-' + mm + '-' + dd;
  }

  function formatDateFR(iso) {
    if (!iso || iso.length < 10) return iso || '';
    return iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
  }

  // À partir de la liste complète, choisit le programme courant et le suivant
  function pickProgrammesPDF(liste) {
    var today = todayISO();
    var actuels = [];
    var futurs = [];

    (Array.isArray(liste) ? liste : []).forEach(function (p) {
      if (!p || !p.debut || !p.fin || !p.fichier) return;
      if (p.debut <= today && today <= p.fin) {
        actuels.push(p);
      } else if (p.debut > today) {
        futurs.push(p);
      }
    });

    actuels.sort(function (a, b) {
      // le plus récent d'abord
      return b.debut.localeCompare(a.debut);
    });

    futurs.sort(function (a, b) {
      // le prochain qui arrive
      return a.debut.localeCompare(b.debut);
    });

    return {
      courant: actuels.length ? actuels[0] : null,
      suivant: futurs.length ? futurs[0] : null
    };
  }

  function renderPdfTab(courant, suivant) {
    var panel = document.getElementById('pdf_panel');
    if (!panel) return;

    if (!courant && !suivant) {
      panel.innerHTML = '<p style="padding:16px;">Aucun programme PDF disponible pour le moment.</p>';
      return;
    }

    function bloc(p, titre) {
      if (!p) return '';
      var label = 'Programme n°' + (p.numero || '') +
        (p.debut && p.fin ? ' — du ' + formatDateFR(p.debut) + ' au ' + formatDateFR(p.fin) : '');

      return (
        '<section class="pdf-tab-section">' +
          (titre ? '<h2 class="pdf-section-title">' + titre + '</h2>' : '') +
          '<div class="pdf-download">' +
            '<a class="btn-pdf" href="PDFs/' + encodeURIComponent(p.fichier) + '" target="_blank" rel="noopener">' +
              'Télécharger le PDF' + (p.numero ? ' n°' + p.numero : '') +
            '</a>' +
          '</div>' +
          '<div class="pdf-viewer">' +
            '<a class="pdf-img-link" href="PDFs/programme_page8.jpg" target="_blank" rel="noopener">' +
              '<img class="pdf-img" src="PDFs/programme_page8.jpg" alt="Dernière page du programme (image)" loading="lazy" decoding="async">' +
            '</a>' +
          '</div>' +
          '<p class="pdf-caption">' + label + '</p>' +
        '</section>'
      );
    }

    var html = '';
    html += bloc(courant, '');
    if (suivant) {
      html += bloc(suivant, 'Programme suivant');
    }
    panel.innerHTML = html;
  }

    function ensurePdfTabLoaded() {
    if (window._pdfTabLoaded && window._pdfList) {
      var pick = pickProgrammesPDF(window._pdfList);
      renderPdfTab(pick.courant, pick.suivant);
      return;
    }
    window._pdfTabLoaded = true;

    fetch('./PDFs.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (liste) {
        window._pdfList = Array.isArray(liste) ? liste : [];
        var pick = pickProgrammesPDF(window._pdfList);
        renderPdfTab(pick.courant, pick.suivant);
      })
      .catch(function (e) {
        console.warn('Erreur chargement PDFs.json:', e);
        var panel = document.getElementById('pdf_panel');
        if (panel) {
          panel.innerHTML = '<p style="padding:16px;">Impossible de charger le PDF pour le moment.</p>';
        }
      });
  }

  // ===================== ONGLET PROCHAINEMENT =====================

  function renderProchTab(list) {
    var cont = document.getElementById('coming_grid');
    if (!cont) return;

    if (!Array.isArray(list) || list.length === 0) {
      cont.innerHTML = '<p>Aucune affiche « prochainement » pour le moment.</p>';
      return;
    }

    cont.innerHTML = list.map(function (item) {
      if (!item || !item.poster) return '';
      var alt = item.alt || 'Affiche de film';
      return (
        '<div class="coming-poster-wrap">' +
          '<img class="coming-poster" src="' + item.poster + '" alt="' +
          alt.replace(/"/g, '&quot;') + '">' +
        '</div>'
      );
    }).join('');
  }

  function ensureProchTabLoaded() {
    if (window._prochLoaded) return;
    window._prochLoaded = true;

    fetch('./prochainement.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (list) {
        renderProchTab(list);
      })
      .catch(function (e) {
        console.warn('Erreur chargement prochainement.json:', e);
        var cont = document.getElementById('coming_grid');
        if (cont) {
          cont.innerHTML = '<p>Impossible de charger les films « prochainement ».</p>';
        }
      });
  }

  // ===================== ONGLET ARCHIVES =====================

  function renderArchivesTab(list) {
    var cont = document.getElementById('archives_list');
    if (!cont) return;

    if (!Array.isArray(list) || list.length === 0) {
      cont.innerHTML = '<p style="padding:16px;">Aucune archive disponible pour le moment.</p>';
      return;
    }

    var sorted = list.slice().sort(function (a, b) {
      return (b.debut || '').localeCompare(a.debut || '');
    });

    var html = '<ul class="archives-ul">';
    sorted.forEach(function (p) {
      if (!p || !p.fichier) return;
      var label = '';
      if (p.numero) {
        label += 'Programme n°' + p.numero + ' — ';
      }
      if (p.debut && p.fin) {
        label += 'du ' + formatDateFR(p.debut) + ' au ' + formatDateFR(p.fin);
      } else {
        label += p.fichier;
      }
      html += '<li><a href="PDFs/' + encodeURIComponent(p.fichier) +
              '" target="_blank" rel="noopener">' + label + '</a></li>';
    });
    html += '</ul>';

    cont.innerHTML = html;
  }

  function ensureArchivesTabLoaded() {
    if (window._archivesLoaded && window._pdfList) {
      renderArchivesTab(window._pdfList);
      return;
    }
    window._archivesLoaded = true;

    if (window._pdfList) {
      renderArchivesTab(window._pdfList);
      return;
    }

    fetch('./PDFs.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (liste) {
        window._pdfList = Array.isArray(liste) ? liste : [];
        renderArchivesTab(window._pdfList);
      })
      .catch(function (e) {
        console.warn('Erreur chargement PDFs.json (archives):', e);
        var cont = document.getElementById('archives_list');
        if (cont) {
          cont.innerHTML = '<p style="padding:16px;">Impossible de charger les archives.</p>';
        }
      });
  }



      function selView(n, litag) {
    var ids = ['program_panel', 'pdf_panel', 'proch_panel', 'archives_panel'];

    ids.forEach(function (id, idx) {
      var el = document.getElementById(id);
      if (!el) return;
      el.style.display = (idx === (n - 1) ? 'block' : 'none');
    });

    if (n === 2) {
      ensurePdfTabLoaded();
    } else if (n === 3) {
      ensureProchTabLoaded();
    } else if (n === 4) {
      ensureArchivesTabLoaded();
    }

    var tabs = document.getElementById("tabs");
    var ca = Array.prototype.slice.call(tabs.querySelectorAll("li"));
    ca.forEach(function (elem) {
      elem.className = "";
    });
    if (litag) {
      litag.className = "selected";
    }
  }



    // drag scroll + flèches + onglets
  (function () {
    console.log("main functiion");
    var isDown = false, startX = 0, startScroll = 0;
    var leftBtn = document.getElementById('leftBtn'),
        rightBtn = document.getElementById('rightBtn'),
        jumpStartBtn = document.getElementById('jumpStartBtn');
    var li_prog  = document.getElementById("li_prog"),
        li_pdf   = document.getElementById("li_pdf"),
        li_proch = document.getElementById("li_proch"),
        li_arch  = document.getElementById("li_arch");

    rail.addEventListener('mousedown', function (e) {
      isDown = true;
      startX = e.pageX;
      startScroll = rail.scrollLeft;
      e.preventDefault();
    });
    window.addEventListener('mouseup', function () { isDown = false; });
    window.addEventListener('mousemove', function (e) {
      if (!isDown) return;
      rail.scrollLeft = startScroll - (e.pageX - startX);
    });
    rail.addEventListener('touchstart', function (e) {
      isDown = true;
      startX = e.touches[0].pageX;
      startScroll = rail.scrollLeft;
    }, { passive: true });
    rail.addEventListener('touchend', function () { isDown = false; });
    rail.addEventListener('touchmove', function (e) {
      if (!isDown) return;
      rail.scrollLeft = startScroll - (e.touches[0].pageX - startX);
    }, { passive: true });

    var step = function () {
      var colW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--colW'), 10) || 220;
      var gap  = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--gap'), 10) || 12;
      return colW + gap;
    };

    leftBtn.addEventListener('click', function () {
      rail.scrollBy({ left: -step(), behavior: 'smooth' });
    });
    rightBtn.addEventListener('click', function () {
      rail.scrollBy({ left: step(), behavior: 'smooth' });
    });
    if (jumpStartBtn) {
      jumpStartBtn.addEventListener('click', function () {
        rail.scrollTo({ left: 0, behavior: 'smooth' });
      });
    }

    if (calendarBtn) {
      calendarBtn.addEventListener('click', function () {
        openCalendar();
      });
    }
    if (calendarOverlay) {
      calendarOverlay.addEventListener('click', function (e) {
        if (e.target === calendarOverlay) closeCalendar();
      });
    }
    if (calPrev) {
      calPrev.addEventListener('click', function () {
        shiftCalendarMonth(-1);
      });
    }
    if (calNext) {
      calNext.addEventListener('click', function () {
        shiftCalendarMonth(1);
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && calendarOverlay && calendarOverlay.classList.contains('open')) {
        closeCalendar();
      }
    });


    // Onglets
    if (li_prog)  li_prog.addEventListener("click", function () { selView(1, li_prog); });
    if (li_pdf)   li_pdf.addEventListener("click", function () { selView(2, li_pdf); });
    if (li_proch) li_proch.addEventListener("click", function () { selView(3, li_proch); });
    if (li_arch)  li_arch.addEventListener("click", function () { selView(4, li_arch); });

    // État initial : programme
    selView(1, li_prog);
  })();

})();
