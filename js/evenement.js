(function () {
  'use strict';

  var grid = document.getElementById('cinespana-films');
  if (!grid) return;

  var cards = [];
  var activeCard = null;
  var detail = element('div', 'cinespana-detail');
  detail.id = 'cinespana-detail';
  detail.hidden = true;
  detail.setAttribute('role', 'region');
  detail.setAttribute('aria-labelledby', 'cinespana-detail-title');
  grid.appendChild(detail);

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function duration(value) {
    var minutes = Number(value);
    if (!minutes) return '';
    return Math.floor(minutes / 60) + ' h ' + String(minutes % 60).padStart(2, '0');
  }

  function screeningDate(film) {
    return new Date(film.date + 'T12:00:00').toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long'
    }) + ' à ' + film.heure.replace(':', ' h ');
  }

  function externalLink(label, url) {
    var link = element('a', '', label);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function createTrailer(film) {
    var url = String(film.trailer_url || '').trim();
    if (!url) return null;

    // Same players, settings and 16:9 frame as the Programme carousel.
    var youtube = /(?:v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/.exec(url);
    var vimeo = /vimeo\.com\/(?:video\/)?([0-9]+)/.exec(url);
    var dailymotion = /(?:dailymotion\.com\/(?:embed\/)?video\/|dai\.ly\/)([a-zA-Z0-9]+)/.exec(url);
    var player;
    if (youtube || vimeo || dailymotion) {
      player = element('iframe');
      if (youtube) player.src = 'https://www.youtube.com/embed/' + youtube[1] + '?autoplay=0&rel=0';
      else if (vimeo) player.src = 'https://player.vimeo.com/video/' + vimeo[1] + '?autoplay=0';
      else player.src = 'https://www.dailymotion.com/embed/video/' + dailymotion[1];
      player.title = 'Bande-annonce - ' + film.titre;
      player.allow = 'autoplay; fullscreen; picture-in-picture';
      player.allowFullscreen = true;
    } else if (/^https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)(?:\?[^\s"'<>]*)?$/i.test(url)) {
      player = element('video');
      player.controls = true;
      player.preload = 'metadata';
      player.setAttribute('aria-label', 'Bande-annonce - ' + film.titre);
      var source = element('source');
      source.src = url;
      source.type = /\.m3u8(?:\?|$)/i.test(url) ? 'application/x-mpegURL' : 'video/mp4';
      player.appendChild(source);
    } else {
      return null;
    }

    var trailer = element('div', 'trailer');
    var frame = element('div', 'trailer-frame');
    frame.appendChild(player);
    trailer.appendChild(frame);
    return trailer;
  }

  function closeDetail(returnFocus) {
    if (!activeCard) return;
    var previous = activeCard;
    previous.setAttribute('aria-expanded', 'false');
    previous.querySelector('.cinespana-card-action').textContent = 'Découvrir le film';
    // Unmount the player so playback also stops when the accordion is closed.
    var trailer = detail.querySelector('.trailer');
    if (trailer) trailer.remove();
    detail.hidden = true;
    activeCard = null;
    if (returnFocus) previous.focus();
  }

  function placeDetail() {
    if (!activeCard) return;
    // Measure the poster row without the expanded panel influencing grid placement.
    detail.hidden = true;
    var rowTop = activeCard.offsetTop;
    var last = activeCard;
    cards.forEach(function (card) {
      if (Math.abs(card.offsetTop - rowTop) < 2) last = card;
    });
    if (last.nextElementSibling !== detail) grid.insertBefore(detail, last.nextSibling);
    detail.hidden = false;
  }

  function fillDetail(film) {
    detail.replaceChildren();
    var head = element('div', 'cinespana-detail-head');
    var title = element('h3', 'panel-title', film.titre);
    title.id = 'cinespana-detail-title';
    var close = element('button', 'cinespana-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer la fiche de ' + film.titre);
    close.addEventListener('click', function () { closeDetail(true); });
    head.append(title, close);

    var body = element('div', 'cinespana-detail-body');
    var copy = element('div', 'cinespana-detail-copy');
    copy.appendChild(element('p', 'genresLine', screeningDate(film)));
    copy.appendChild(element('p', 'infoLine', [film.version, film.pays, duration(film.duree_min)].filter(Boolean).join(' / ')));
    if (film.genres) copy.appendChild(element('p', 'genresLine', film.genres));
    var credits = element('div', 'kv');
    [['De :', film.realisateur], ['Avec :', film.acteurs_principaux]].forEach(function (credit) {
      if (!credit[1]) return;
      credits.append(element('span', 'k', credit[0]), element('span', 'v', credit[1]));
    });
    copy.appendChild(credits);
    if (film.recompenses) copy.appendChild(element('p', 'recompensesLine', film.recompenses));
    if (film.commentaire) copy.appendChild(element('p', 'infoLine', film.commentaire));
    if (film.synopsis) copy.appendChild(element('p', 'synopsis', film.synopsis));

    var trailer = createTrailer(film);
    var links = element('div', 'cinespana-links');
    if (film.trailer_url && !trailer) links.appendChild(externalLink('Voir la bande-annonce ↗', film.trailer_url));
    if (film.allocine_url) links.appendChild(externalLink('Le film sur Allociné ↗', film.allocine_url));
    copy.appendChild(links);
    body.appendChild(copy);
    if (Array.isArray(film.backdrops) && film.backdrops[0]) {
      var image = element('img', 'cinespana-backdrop');
      image.src = film.backdrops[0];
      image.alt = 'Image du film ' + film.titre;
      image.loading = 'lazy';
      image.decoding = 'async';
      body.appendChild(image);
    } else {
      body.style.gridTemplateColumns = '1fr';
    }
    detail.append(head, body);
    if (trailer) detail.appendChild(trailer);
  }

  function toggleDetail(card, film) {
    if (activeCard === card) {
      closeDetail(false);
      return;
    }
    closeDetail(false);
    activeCard = card;
    card.setAttribute('aria-expanded', 'true');
    card.querySelector('.cinespana-card-action').textContent = 'Refermer la fiche';
    placeDetail();
    fillDetail(film);
  }

  function renderFilm(film) {
    var card = element('button', 'cinespana-card');
    card.type = 'button';
    card.setAttribute('aria-expanded', 'false');
    card.setAttribute('aria-controls', detail.id);
    card.setAttribute('aria-label', film.titre + ' — ' + screeningDate(film) + ' — détails du film');

    var session = element('time', 'cinespana-session');
    session.dateTime = film.date + 'T' + film.heure;
    var weekday = new Date(film.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '').toUpperCase();
    session.append(
      element('span', '', weekday + ' ' + film.date.slice(8, 10) + '/' + film.date.slice(5, 7)),
      element('span', '', film.heure.replace(':', ' h '))
    );
    var poster = element('img', 'cinespana-poster');
    poster.src = film.affiche_url;
    poster.alt = 'Affiche de ' + film.titre;
    poster.loading = 'lazy';
    poster.decoding = 'async';
    card.append(
      session,
      poster,
      element('span', 'cinespana-card-title', film.titre),
      element('span', 'cinespana-card-meta', [film.version, duration(film.duree_min)].filter(Boolean).join(' · ')),
      element('span', 'cinespana-card-action', 'Découvrir le film')
    );
    card.addEventListener('click', function () { toggleDetail(card, film); });
    cards.push(card);
    grid.insertBefore(card, detail);
  }

  fetch('data/programme.json', { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (programme) {
      var films = programme.filter(function (film) {
        var category = String(film.categorie || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        return category.includes('cinespana') && film.date >= grid.dataset.start && film.date <= grid.dataset.end;
      });
      films.sort(function (a, b) { return (a.date + a.heure).localeCompare(b.date + b.heure); });
      if (!films.length) throw new Error('Aucune séance Cinespaña');
      films.forEach(renderFilm);
      grid.querySelector('.cinespana-status').remove();
    })
    .catch(function () {
      var status = grid.querySelector('.cinespana-status');
      status.textContent = 'Les fiches des films sont momentanément indisponibles. ';
      var link = element('a', '', 'Consulter le programme');
      link.href = 'index.html';
      status.appendChild(link);
    });

  window.addEventListener('resize', placeDetail);
  grid.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && activeCard) {
      event.preventDefault();
      closeDetail(true);
    }
  });
})();
