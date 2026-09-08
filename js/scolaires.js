(function () {
  'use strict';

  var grid = document.getElementById('school-grid');
  var status = document.getElementById('school-status');
  var films = [];
  var cards = [];
  var activeCard = null;
  var detail = createDetail();
  var resizeFrame = null;

  function createElement(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function createDetail() {
    var section = createElement('section', 'school-detail');
    section.id = 'school-detail';
    section.hidden = true;
    section.setAttribute('aria-hidden', 'true');
    section.setAttribute('aria-labelledby', 'school-detail-title');

    var reveal = createElement('div', 'school-detail-reveal');
    var panel = createElement('div', 'school-detail-panel');
    var layout = createElement('div', 'school-detail-layout');
    var copy = createElement('div', 'school-detail-copy');
    var media = createElement('div', 'school-detail-media');

    var title = createElement('h2', 'school-detail-title');
    title.id = 'school-detail-title';
    var info = createElement('p', 'school-detail-info');
    var genres = createElement('p', 'school-detail-genres');
    var credits = createElement('div', 'school-detail-credits');
    var awards = createElement('p', 'school-detail-awards');
    var synopsis = createElement('p', 'school-detail-synopsis');
    var link = createElement('a', 'school-detail-link');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    var backdrop = createElement('img', 'school-detail-backdrop');
    backdrop.alt = '';
    backdrop.loading = 'lazy';
    backdrop.decoding = 'async';
    var thumbs = createElement('div', 'school-detail-thumbs');
    thumbs.setAttribute('aria-label', 'Photos du film');

    var trailer = createElement('div', 'school-detail-trailer');

    copy.appendChild(title);
    copy.appendChild(info);
    copy.appendChild(genres);
    copy.appendChild(credits);
    copy.appendChild(awards);
    copy.appendChild(synopsis);
    copy.appendChild(link);
    media.appendChild(backdrop);
    media.appendChild(thumbs);
    layout.appendChild(copy);
    layout.appendChild(media);
    panel.appendChild(layout);
    panel.appendChild(trailer);
    reveal.appendChild(panel);
    section.appendChild(reveal);

    section._parts = {
      title: title,
      info: info,
      genres: genres,
      credits: credits,
      awards: awards,
      synopsis: synopsis,
      link: link,
      backdrop: backdrop,
      thumbs: thumbs,
      trailer: trailer
    };
    return section;
  }

  function formatDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    return match ? match[3] + '.' + match[2] + '.' + match[1] : String(value || '');
  }

  function formatDuration(value) {
    var minutes = parseInt(value, 10);
    if (isNaN(minutes)) return '';
    if (minutes < 60) return minutes + ' min';
    return Math.floor(minutes / 60) + 'h' + String(minutes % 60).padStart(2, '0');
  }

  function posterUrl(url) {
    return String(url || '');
  }

  function mediumImageUrl(url) {
    return String(url || '').replace('/original/', '/w780/');
  }

  function smallImageUrl(url) {
    return String(url || '').replace('/original/', '/w300/');
  }

  function addCredit(container, label, value) {
    if (!value) return;
    container.appendChild(createElement('span', 'school-detail-label', label));
    container.appendChild(createElement('span', 'school-detail-value', value));
  }

  function mediaId(url, pattern) {
    var match = pattern.exec(String(url || ''));
    return match && match[1] ? match[1] : '';
  }

  function renderTrailer(container, url, title) {
    container.textContent = '';
    if (!url) return;

    var youtube = mediaId(url, /(?:v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{6,})/);
    var vimeo = mediaId(url, /(?:vimeo\.com\/(?:video\/)?)([0-9]+)/);
    var dailymotion = mediaId(url, /(?:dailymotion\.com\/(?:embed\/)?video\/|dai\.ly\/)([a-zA-Z0-9]+)/);
    var frame = createElement('div', 'school-trailer-frame');

    if (youtube || vimeo || dailymotion) {
      var iframe = document.createElement('iframe');
      if (youtube) iframe.src = 'https://www.youtube.com/embed/' + youtube + '?autoplay=0&rel=0';
      if (vimeo) iframe.src = 'https://player.vimeo.com/video/' + vimeo + '?autoplay=0';
      if (dailymotion) iframe.src = 'https://www.dailymotion.com/embed/video/' + dailymotion;
      iframe.title = 'Bande-annonce — ' + title;
      iframe.loading = 'lazy';
      iframe.allow = 'autoplay; fullscreen; picture-in-picture';
      iframe.allowFullscreen = true;
      frame.appendChild(iframe);
    } else if (/^https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)(?:\?[^\s"'<>]*)?$/i.test(url)) {
      var video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      var source = document.createElement('source');
      source.src = url;
      source.type = /\.m3u8(?:\?|$)/i.test(url) ? 'application/x-mpegURL' : 'video/mp4';
      video.appendChild(source);
      frame.appendChild(video);
    } else {
      return;
    }

    container.appendChild(frame);
  }

  function renderPhotos(film) {
    var parts = detail._parts;
    var photos = Array.isArray(film.backdrops) ? film.backdrops.filter(Boolean).slice(0, 5) : [];
    var mainImage = photos[0] || film.affiche_url || '';

    parts.backdrop.style.display = mainImage ? 'block' : 'none';
    if (mainImage) {
      parts.backdrop.src = mediumImageUrl(mainImage);
      parts.backdrop.alt = 'Image du film ' + (film.titre || '');
    } else {
      parts.backdrop.removeAttribute('src');
      parts.backdrop.alt = '';
    }

    parts.thumbs.textContent = '';
    if (photos.length <= 1) return;

    photos.forEach(function (url, index) {
      var button = createElement('button', 'school-thumb');
      button.type = 'button';
      button.setAttribute('aria-label', 'Afficher la photo ' + (index + 1) + ' sur ' + photos.length);
      button.setAttribute('aria-current', index === 0 ? 'true' : 'false');
      var image = createElement('img');
      image.src = smallImageUrl(url);
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      button.appendChild(image);
      button.addEventListener('click', function () {
        parts.backdrop.src = mediumImageUrl(url);
        parts.thumbs.querySelectorAll('.school-thumb').forEach(function (thumb) {
          thumb.setAttribute('aria-current', thumb === button ? 'true' : 'false');
        });
      });
      parts.thumbs.appendChild(button);
    });
  }

  function fillDetail(film) {
    var parts = detail._parts;
    var meta = [];
    if (film.version) meta.push(film.version);
    if (film.annee) meta.push(formatDate(film.annee));
    if (film.pays) meta.push(film.pays);
    if (film.duree_min) meta.push(formatDuration(film.duree_min));

    parts.title.textContent = film.titre || 'Titre inconnu';
    parts.info.textContent = meta.join(' / ');
    parts.info.style.display = meta.length ? 'block' : 'none';
    parts.genres.textContent = film.genres || '';
    parts.genres.style.display = film.genres ? 'block' : 'none';
    parts.credits.textContent = '';
    addCredit(parts.credits, 'De :', film.realisateur || '');
    addCredit(parts.credits, 'Avec :', film.acteurs_principaux || '');
    parts.credits.style.display = parts.credits.children.length ? 'grid' : 'none';
    parts.awards.textContent = film.recompenses || '';
    parts.awards.style.display = film.recompenses ? 'block' : 'none';
    parts.synopsis.textContent = film.synopsis || '';
    parts.link.style.display = film.allocine_url ? 'inline-block' : 'none';
    if (film.allocine_url) {
      parts.link.href = film.allocine_url;
      parts.link.textContent = '« ' + (film.titre || 'Le film') + ' » sur Allociné';
    } else {
      parts.link.removeAttribute('href');
      parts.link.textContent = '';
    }

    renderPhotos(film);
    renderTrailer(parts.trailer, film.trailer_url || '', film.titre || 'le film');
  }

  function findLastCardInRow(card) {
    var rowTop = card.offsetTop;
    var rowCards = cards.filter(function (candidate) {
      return Math.abs(candidate.offsetTop - rowTop) < 2;
    });
    return rowCards[rowCards.length - 1] || card;
  }

  function placeDetailAfterCardRow(card) {
    if (detail.parentNode) detail.parentNode.removeChild(detail);
    var lastCard = findLastCardInRow(card);
    grid.insertBefore(detail, lastCard.nextSibling);
  }

  function closeDetail(returnFocus) {
    if (!activeCard) return;
    var previous = activeCard;
    previous.setAttribute('aria-expanded', 'false');
    activeCard = null;
    detail.classList.remove('is-open');
    detail.setAttribute('aria-hidden', 'true');
    window.setTimeout(function () {
      if (!activeCard) detail.hidden = true;
    }, 330);
    if (returnFocus) previous.focus();
  }

  function openDetail(card, film) {
    if (activeCard === card) {
      closeDetail(false);
      return;
    }

    if (activeCard) activeCard.setAttribute('aria-expanded', 'false');
    activeCard = card;
    activeCard.setAttribute('aria-expanded', 'true');
    fillDetail(film);
    placeDetailAfterCardRow(card);
    detail.hidden = false;
    detail.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(function () {
      detail.classList.add('is-open');
    });
  }

  function renderCards(list) {
    grid.textContent = '';
    cards = [];

    list.forEach(function (film) {
      var card = createElement('button', 'school-card');
      card.type = 'button';
      card.setAttribute('aria-expanded', 'false');
      card.setAttribute('aria-controls', 'school-detail');
      card.setAttribute('aria-label', 'Voir la fiche de ' + (film.titre || 'ce film'));

      var frame = createElement('span', 'school-poster-frame');
      var image = createElement('img', 'school-poster');
      image.src = posterUrl(film.affiche_url || '');
      image.alt = 'Affiche du film ' + (film.titre || '');
      image.loading = 'lazy';
      image.decoding = 'async';
      var title = createElement('span', 'school-card-title', film.titre || 'Titre inconnu');

      frame.appendChild(image);
      card.appendChild(frame);
      card.appendChild(title);
      card.addEventListener('click', function () {
        openDetail(card, film);
      });
      grid.appendChild(card);
      cards.push(card);
    });
  }

  function loadFilms() {
    fetch('data/scolaires.json', { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        films = Array.isArray(data) ? data.filter(function (film) {
          return film && film.titre && film.affiche_url;
        }) : [];
        films.sort(function (a, b) {
          return a.titre.localeCompare(b.titre, 'fr', { sensitivity: 'base' });
        });

        if (!films.length) {
          status.textContent = 'Aucun film scolaire n’est proposé pour le moment.';
          return;
        }
        renderCards(films);
      })
      .catch(function () {
        status.textContent = 'Impossible de charger les films pour le moment.';
      });
  }

  window.addEventListener('resize', function () {
    if (!activeCard || resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(function () {
      resizeFrame = null;
      if (activeCard) placeDetailAfterCardRow(activeCard);
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && activeCard) closeDetail(true);
  });

  loadFilms();
})();
