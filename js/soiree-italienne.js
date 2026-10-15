(function () {
  'use strict';

  var entries = Array.from(document.querySelectorAll('.italian-event-entry'));
  if (!entries.length) return;

  var films = new Map();
  var loadFailed = false;

  function element(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (value) node.textContent = value;
    return node;
  }

  function safeUrl(value) {
    return /^https?:\/\/[^\s"'<>]+$/i.test(String(value || '').trim()) ? String(value).trim() : '';
  }

  function duration(value) {
    var minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    return Math.floor(minutes / 60) + ' h ' + String(minutes % 60).padStart(2, '0');
  }

  function releaseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return value || '';
    return new Date(value + 'T12:00:00').toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  function addCredit(list, label, value) {
    if (!value) return;
    var row = element('div');
    row.append(element('dt', '', label), element('dd', '', value));
    list.appendChild(row);
  }

  function addGallery(detail, film) {
    var urls = (Array.isArray(film.backdrops) ? film.backdrops : [])
      .map(safeUrl).filter(Boolean).filter(function (url, index, all) { return all.indexOf(url) === index; })
      .slice(0, 5);
    if (!urls.length) return;

    var gallery = element('div', 'italian-detail-gallery');
    var image = element('img', 'italian-detail-image');
    image.src = urls[0];
    image.alt = 'Image du film ' + film.titre;
    image.loading = 'lazy';
    image.decoding = 'async';
    gallery.appendChild(image);

    if (urls.length > 1) {
      var thumbs = element('div', 'italian-detail-thumbs');
      thumbs.setAttribute('role', 'group');
      thumbs.setAttribute('aria-label', 'Photos du film ' + film.titre);
      urls.forEach(function (url, index) {
        var button = element('button');
        button.type = 'button';
        button.setAttribute('aria-label', 'Voir la photo ' + (index + 1) + ' sur ' + urls.length);
        button.setAttribute('aria-current', index === 0 ? 'true' : 'false');
        var thumbnail = element('img');
        thumbnail.src = url;
        thumbnail.alt = '';
        thumbnail.loading = 'lazy';
        thumbnail.decoding = 'async';
        button.appendChild(thumbnail);
        button.addEventListener('click', function () {
          image.src = url;
          thumbs.querySelectorAll('button').forEach(function (item) {
            item.setAttribute('aria-current', item === button ? 'true' : 'false');
          });
        });
        thumbs.appendChild(button);
      });
      gallery.appendChild(thumbs);
    }
    detail.appendChild(gallery);
  }

  function addTrailer(detail, film) {
    var url = safeUrl(film.trailer_url);
    if (!url) return;

    var trailer = element('div', 'italian-detail-trailer');
    trailer.appendChild(element('h4', '', 'Bande-annonce'));
    var frame = element('div', 'italian-detail-trailer-frame');
    var youtube = /(?:youtube\.com\/watch\?[^#]*v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/.exec(url);
    var vimeo = /vimeo\.com\/(?:video\/)?([0-9]+)/.exec(url);
    var player;

    if (youtube || vimeo) {
      player = element('iframe');
      if (youtube) player.src = 'https://www.youtube.com/embed/' + youtube[1] + '?autoplay=0&rel=0';
      else if (vimeo) player.src = 'https://player.vimeo.com/video/' + vimeo[1] + '?autoplay=0';
      player.title = 'Bande-annonce — ' + film.titre;
      player.loading = 'lazy';
      player.allow = 'autoplay; fullscreen; picture-in-picture';
      player.allowFullscreen = true;
    } else if (/\.(?:mp4|m3u8)(?:\?|$)/i.test(url)) {
      player = element('video');
      player.controls = true;
      player.preload = 'metadata';
      var source = element('source');
      source.src = url;
      source.type = /\.m3u8(?:\?|$)/i.test(url) ? 'application/x-mpegURL' : 'video/mp4';
      player.appendChild(source);
    }

    if (player) {
      frame.appendChild(player);
      trailer.appendChild(frame);
    }
    var link = element('a', 'italian-detail-link' + (player ? '' : ' italian-detail-trailer-cta'),
      player ? 'Ouvrir la bande-annonce ↗' : 'Regarder la bande-annonce ↗');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    trailer.appendChild(link);
    detail.appendChild(trailer);
  }

  function renderDetail(detail, film) {
    detail.replaceChildren();
    detail.appendChild(element('h3', '', film.titre));
    var info = [film.version === 'VO' ? 'VOST' : film.version, film.pays, duration(film.duree_min)].filter(Boolean);
    if (info.length) detail.appendChild(element('p', 'italian-detail-info', info.join(' · ')));
    if (film.genres) detail.appendChild(element('p', 'italian-detail-genres', film.genres));

    var credits = element('dl', 'italian-detail-credits');
    addCredit(credits, 'De', film.realisateur);
    addCredit(credits, 'Avec', film.acteurs_principaux);
    addCredit(credits, 'Sortie', releaseDate(film.annee));
    addCredit(credits, 'Tarif', film.tarif);
    addCredit(credits, 'Public', film.classification);
    if (credits.childElementCount) detail.appendChild(credits);

    if (film.synopsis) detail.appendChild(element('p', 'italian-detail-synopsis', film.synopsis));
    var allocine = safeUrl(film.allocine_url);
    if (allocine) {
      var link = element('a', 'italian-detail-link', 'Fiche du film sur Allociné ↗');
      link.href = allocine;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      detail.appendChild(link);
    }
    addGallery(detail, film);
    addTrailer(detail, film);
  }

  function closeEntry(entry) {
    entry.querySelector('.italian-event-film').setAttribute('aria-expanded', 'false');
    entry.querySelector('.italian-event-film-action-label').textContent = 'Découvrir le film';
    var detail = entry.querySelector('.italian-event-detail');
    detail.hidden = true;
    detail.replaceChildren(); // Retirer le lecteur arrête aussi la bande-annonce.
  }

  function openEntry(entry) {
    entries.forEach(function (other) { if (other !== entry) closeEntry(other); });
    var button = entry.querySelector('.italian-event-film');
    var detail = entry.querySelector('.italian-event-detail');
    button.setAttribute('aria-expanded', 'true');
    entry.querySelector('.italian-event-film-action-label').textContent = 'Refermer la fiche';
    detail.hidden = false;
    var film = films.get(entry.dataset.heure);
    if (film) renderDetail(detail, film);
    else {
      detail.replaceChildren();
      detail.appendChild(element('p', '', loadFailed ?
        'La fiche est momentanément indisponible. Retrouvez le film dans le programme.' :
        'Chargement de la fiche du film…'));
    }
  }

  entries.forEach(function (entry) {
    var button = entry.querySelector('.italian-event-film');
    button.addEventListener('click', function () {
      if (button.getAttribute('aria-expanded') === 'true') closeEntry(entry);
      else openEntry(entry);
    });
    entry.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
        closeEntry(entry);
        button.focus();
      }
    });
  });

  fetch('data/programme.json', { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (programme) {
      entries.forEach(function (entry) {
        var heure = entry.dataset.heure;
        var film = programme.find(function (item) { return item.date === '2026-11-07' && item.heure === heure; });
        if (!film) {
          loadFailed = true;
          if (entry.querySelector('.italian-event-film').getAttribute('aria-expanded') === 'true') openEntry(entry);
          return;
        }
        films.set(heure, film);
        var poster = entry.querySelector('.italian-event-film-poster');
        if (safeUrl(film.affiche_url)) poster.src = film.affiche_url;
        if (entry.querySelector('.italian-event-film').getAttribute('aria-expanded') === 'true') {
          renderDetail(entry.querySelector('.italian-event-detail'), film);
        }
      });
    })
    .catch(function () {
      loadFailed = true;
      entries.forEach(function (entry) {
        if (entry.querySelector('.italian-event-film').getAttribute('aria-expanded') === 'true') {
          openEntry(entry);
        }
      });
    });
})();
