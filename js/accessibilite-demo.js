(function () {
  'use strict';

  var container = document.getElementById('access-sessions');
  if (!container) return;
  var loadedItems = [];
  var hasLoaded = false;
  var demo = new URLSearchParams(window.location.search).get('demo') === '1';
  var feedURL = container.getAttribute('data-access-feed') || './data/accessibilite.json';
  var dialog = document.getElementById('access-device-dialog');
  var dialogTrigger = null;
  var renderPending = false;

  var DEVICE_LABELS = {
    ad: {
      label: 'Audiodescription',
      ariaLabel: 'Audiodescription (AD)',
      icon: 'seeing'
    },
    hi: {
      label: 'Son renforc\u00e9',
      ariaLabel: 'Son renforc\u00e9 (HI)',
      icon: 'hearing'
    },
    sme: {
      label: 'Sous-titres sourds et malentendants',
      ariaLabel: 'Sous-titres sourds et malentendants (SME)',
      icon: 'hearing'
    },
    vast: {
      label: 'Audio-sous-titrage',
      ariaLabel: 'Audio-sous-titrage (VAST)',
      icon: 'subtitles'
    }
  };

  var EMPTY_MESSAGE = 'Aucune s\u00e9ance accessible n\u2019est confirm\u00e9e pour le moment. Revenez bient\u00f4t ou contactez le cin\u00e9ma.';

  var dateFormatter = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });

  var HELP_TITLES = {
    hearing: 'Aides pour mieux entendre',
    seeing: 'Aide pour mieux voir',
    subtitles: 'Aide pour suivre les sous-titres'
  };

  var ICONS = {
    hearing: 'icons/accessibilite/audition.svg',
    seeing: 'icons/accessibilite/vision-jaune.svg',
    subtitles: 'icons/accessibilite/sous-titres.svg'
  };

  function formatDate(dateValue) {
    if (!dateValue) return '';
    var date = new Date(dateValue + 'T00:00:00');
    if (Number.isNaN(date.getTime())) return dateValue;
    return dateFormatter.format(date);
  }

  function createIcon(iconName) {
    var icon = document.createElement('span');
    icon.className = 'access-badge-icon';
    icon.setAttribute('aria-hidden', 'true');
    var image = document.createElement('img');
    image.src = ICONS[iconName] || ICONS.subtitles;
    image.alt = '';
    image.width = 20;
    image.height = 20;
    image.decoding = 'async';
    icon.appendChild(image);
    return icon;
  }

  function setupHelpPanel() {
    var panel = document.getElementById('access-help-panel');
    if (!panel) return;

    var title = document.getElementById('access-help-title');
    var closeButton = panel.querySelector('[data-access-help-close]');
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-access-topic]'));
    var cards = Array.prototype.slice.call(panel.querySelectorAll('[data-access-help]'));
    var activeButton = null;

    if (!title || !closeButton || !buttons.length || !cards.length) return;

    function setButtonStates(topic) {
      buttons.forEach(function (button) {
        var isActive = button.getAttribute('data-access-topic') === topic;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-expanded', isActive ? 'true' : 'false');
      });
    }

    function focusTitle() {
      try {
        title.focus({ preventScroll: true });
      } catch (error) {
        title.focus();
      }
    }

    function openHelp(topic, trigger) {
      activeButton = trigger || activeButton;
      title.textContent = HELP_TITLES[topic] || 'Les dispositifs possibles';
      panel.hidden = false;
      panel.setAttribute('data-topic', topic);

      cards.forEach(function (card) {
        card.hidden = card.getAttribute('data-access-help') !== topic;
      });

      setButtonStates(topic);
      panel.scrollIntoView({ block: 'nearest' });
      focusTitle();
    }

    function closeHelp(restoreFocus) {
      panel.hidden = true;
      panel.removeAttribute('data-topic');
      cards.forEach(function (card) {
        card.hidden = true;
      });
      setButtonStates('');

      if (restoreFocus && activeButton) {
        activeButton.focus();
      }
      activeButton = null;
    }

    cards.forEach(function (card) {
      card.hidden = true;
    });

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        openHelp(button.getAttribute('data-access-topic'), button);
      });
    });

    closeButton.addEventListener('click', function () {
      closeHelp(true);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !dialog.open && !panel.hidden) {
        closeHelp(true);
      }
    });
  }

  function createPoster(item, className) {
    var posterBox = document.createElement('div');
    posterBox.className = className || 'access-session-poster';

    if (item.affiche) {
      var img = document.createElement('img');
      posterBox.classList.add('has-image');
      img.src = item.affiche;
      img.alt = 'Affiche du film ' + (item.titre || 'Film');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', function () {
        posterBox.classList.remove('has-image');
        posterBox.textContent = 'Affiche non disponible';
        posterBox.classList.add('is-placeholder');
      });
      posterBox.appendChild(img);
    } else {
      posterBox.textContent = 'Affiche non disponible';
      posterBox.classList.add('is-placeholder');
    }

    return posterBox;
  }

  function appendBadges(parent, devices, applications) {
    var list = document.createElement('ul');
    list.className = 'access-badge-list';
    list.setAttribute('aria-label', 'Dispositifs disponibles');

    (devices || []).forEach(function (code) {
      var device = DEVICE_LABELS[code];
      if (!device) return;

      var item = document.createElement('li');
      var application = (applications || {})[code];
      var publicLabel = device.label + (application ? ' avec ' + application : '');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'access-badge access-badge--' + code;
      button.setAttribute('aria-haspopup', 'dialog');
      button.dataset.action = code;
      button.appendChild(createIcon(device.icon));

      var label = document.createElement('span');
      label.textContent = publicLabel;
      button.appendChild(label);
      button.addEventListener('click', function () {
        openDeviceDialog(button, code, application, publicLabel);
      });
      item.appendChild(button);

      list.appendChild(item);
    });

    parent.appendChild(list);
  }

  function appendMeta(parent, item) {
    var infoParts = [item.version, item.duree, item.pays, item.genre].filter(Boolean);
    var cast = String(item.acteurs_principaux || '').split(/\s*[,;]\s*/).filter(Boolean).slice(0, 3);
    var hasMeta = infoParts.length || item.realisateur || cast.length;
    if (!hasMeta) return;

    var meta = document.createElement('div');
    meta.className = 'access-film-meta';

    if (infoParts.length) {
      var infoLine = document.createElement('p');
      infoLine.className = 'access-film-infoLine';
      infoLine.textContent = infoParts.join(' / ');
      meta.appendChild(infoLine);
    }

    if (item.realisateur) {
      var credit = document.createElement('p');
      credit.className = 'access-film-credit';
      credit.textContent = 'Film de ' + item.realisateur;
      meta.appendChild(credit);
    }

    if (cast.length) {
      var actors = document.createElement('p');
      actors.className = 'access-film-cast';
      actors.textContent = 'Avec ' + cast.join(', ');
      meta.appendChild(actors);
    }
    parent.appendChild(meta);
  }

  function getPublicNote(item) {
    var note = item && item.note ? String(item.note).trim() : '';
    if (!note) return '';

    return note;
  }

  function getSynopsis(item) {
    if (!item) return '';
    return String(item.synopsis || item.resume || '').trim();
  }

  function openDeviceDialog(button, code, application, label) {
    if (dialog.open) {
      if (dialogTrigger === button) dialog.close();
      return;
    }
    var bring = 'Apportez votre t\u00e9l\u00e9phone charg\u00e9 et vos \u00e9couteurs. ';
    var welcome = 'Si besoin, demandez de l\u2019aide \u00e0 l\u2019accueil avant le film.';
    var prepareRoom = bring + 'Contactez le cin\u00e9ma avant votre venue pour obtenir le bon lien et installer l\u2019application utilis\u00e9e en salle.';
    var help = {
      sme: ['Ces sous-titres affichent les dialogues et les sons importants du film.',
        'Les sous-titres sont projet\u00e9s \u00e0 l\u2019\u00e9cran pendant la s\u00e9ance. Aucune application, aucun t\u00e9l\u00e9phone ni \u00e9couteurs ne sont n\u00e9cessaires.'],
      hi: ['Le son renforc\u00e9 rend les dialogues plus faciles \u00e0 entendre.', prepareRoom],
      ad: ['Une voix d\u00e9crit les \u00e9l\u00e9ments visuels du film, comme les gestes, les expressions et les d\u00e9cors, dans les moments o\u00f9 elle ne g\u00eane pas les dialogues.', prepareRoom],
      vast: ['Les sous-titres du film en version originale sont lus \u00e0 voix haute.',
        'Pr\u00e9parez la piste du film dans l\u2019application indiqu\u00e9e et apportez des \u00e9couteurs. Lancez la synchronisation au d\u00e9but du film.']
    };
    var copy = help[code].slice();
    var guide = dialog.querySelector('.access-device-guide');
    var qr = guide.querySelector('img');
    var room = dialog.querySelector('.access-device-room');
    var inRoom = code === 'sme' ? '' : welcome;
    var download = null;
    if ((code === 'ad' || code === 'hi') && !application) {
      inRoom = 'Connectez votre t\u00e9l\u00e9phone au Wi-Fi d\u00e9di\u00e9 de la salle. Ouvrez l\u2019application et s\u00e9lectionnez la piste de ' +
        (code === 'ad' ? 'l\u2019audiodescription' : 'son renforc\u00e9') + '. ' + welcome;
    }
    if (code === 'ad' && application === 'La Bavarde') {
      copy[1] = bring + 'Installez La Bavarde et t\u00e9l\u00e9chargez chez vous la piste du film en version cin\u00e9ma.';
      download = ['la-bavarde', 'https://labavarde.fr/', 'T\u00e9l\u00e9charger La Bavarde'];
      inRoom = 'Autorisez l\u2019acc\u00e8s au micro pour que l\u2019application puisse se caler sur le son du film. Ouvrez la piste et lancez la synchronisation au d\u00e9but du film. ' + welcome;
    } else if (code === 'vast' && application === 'Tout en Parlant') {
      copy[1] = bring + 'Consultez le guide de Tout en Parlant : installez MovieReading ou La Bavarde, selon l\u2019application qui propose la piste du film. T\u00e9l\u00e9chargez cette piste avant de venir.';
      download = ['tout-en-parlant', 'https://www.toutenparlant.org/vast-cinema/acceder-a-la-vast', 'Choisir et t\u00e9l\u00e9charger l\u2019application'];
      inRoom = 'Ouvrez la piste t\u00e9l\u00e9charg\u00e9e et lancez la synchronisation au d\u00e9but du film. ' + welcome;
    }
    guide.hidden = !download;
    if (download) {
      qr.src = 'icons/accessibilite/qr-' + download[0] + '.svg';
      guide.href = download[1];
      guide.querySelector('span').textContent = download[2];
    } else {
      qr.removeAttribute('src');
      guide.removeAttribute('href');
    }
    room.hidden = !inRoom;
    room.querySelector('p').textContent = inRoom;
    dialog.querySelector('h2').textContent = label;
    dialog.querySelector('.access-device-description').textContent = copy[0];
    dialog.querySelector('.access-device-instructions').textContent = copy[1];
    dialogTrigger = button;
    dialog.showModal();
  }

  function publicURL(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      var url = new URL(value, document.baseURI);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch (error) {
      return null;
    }
  }

  function allocineURL(item) {
    return publicURL(item.allocine_url || item.AllocineURL || item.allocine ||
      item.url_allocine || item.AlloCine || item.allocineUrl)?.href || '';
  }

  function photoURLs(item) {
    var poster = publicURL(item.affiche);
    return Array.from(new Set((Array.isArray(item.backdrops) ? item.backdrops : [])
      .map(publicURL).filter(function (url) {
        return url && (!poster || url.pathname.split('/').pop() !== poster.pathname.split('/').pop());
      }).map(function (url) { return url.href; }))).slice(0, 5);
  }

  function trailerSource(value) {
    var url = publicURL(value);
    if (!url) return null;
    var host = url.hostname;
    var id;
    if (['www.youtube.com', 'youtube.com', 'youtu.be'].includes(host)) {
      id = url.searchParams.get('v') || url.pathname.split('/').pop();
      if (/^[\w-]{11}$/.test(id)) return { embed: 'https://www.youtube.com/embed/' + id + '?rel=0' };
    }
    if (['vimeo.com', 'player.vimeo.com'].includes(host)) {
      id = url.pathname.split('/').pop();
      if (/^\d+$/.test(id)) return { embed: 'https://player.vimeo.com/video/' + id };
    }
    if (['www.dailymotion.com', 'dailymotion.com', 'dai.ly'].includes(host)) {
      id = url.pathname.split('/').pop();
      if (/^[a-zA-Z0-9]+$/.test(id)) return { embed: 'https://www.dailymotion.com/embed/video/' + id };
    }
    if (/\.(mp4|m3u8)$/i.test(url.pathname)) {
      return { video: url.href, type: /\.m3u8$/i.test(url.pathname) ? 'application/x-mpegURL' : 'video/mp4' };
    }
    return null;
  }

  function appendFilmDetails(parent, item) {
    var synopsis = getSynopsis(item);
    if (synopsis) {
      var paragraph = document.createElement('p');
      paragraph.className = 'access-session-synopsis';
      paragraph.textContent = synopsis;
      parent.appendChild(paragraph);
    }
    var allocine = allocineURL(item);
    if (allocine) {
      var link = document.createElement('a');
      link.className = 'allocineLink';
      link.href = allocine;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = item.titre + ' sur Allocin\u00e9';
      parent.appendChild(link);
    }
    var photos = photoURLs(item);
    if (photos.length) {
      var gallery = document.createElement('div');
      gallery.className = 'access-film-gallery';
      var image = document.createElement('img');
      image.loading = 'lazy';
      function selectPhoto(index) {
        image.src = photos[index];
        image.alt = 'Photo ' + (index + 1) + ' du film ' + item.titre;
      }
      selectPhoto(0);
      gallery.appendChild(image);
      if (photos.length > 1) {
        var strip = document.createElement('div');
        strip.className = 'thumb-strip thumb-strip--' + photos.length;
        photos.forEach(function (url, index) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'thumb';
          button.setAttribute('aria-label', 'Photo ' + (index + 1) + ' sur ' + photos.length);
          button.setAttribute('aria-current', String(index === 0));
          var thumb = document.createElement('img');
          thumb.src = url.replace('/w780/', '/w300/');
          thumb.alt = '';
          thumb.loading = 'lazy';
          button.appendChild(thumb);
          button.addEventListener('click', function () {
            selectPhoto(index);
            Array.from(strip.children).forEach(function (entry) {
              entry.setAttribute('aria-current', String(entry === button));
            });
          });
          strip.appendChild(button);
        });
        gallery.appendChild(strip);
      }
      parent.appendChild(gallery);
    }
    var trailer = trailerSource(item.trailer_url);
    if (trailer) {
      var player = document.createElement(trailer.embed ? 'iframe' : 'video');
      var label = 'Bande-annonce : ' + item.titre;
      if (trailer.embed) {
        player.src = trailer.embed;
        player.title = label;
        player.loading = 'lazy';
        player.allowFullscreen = true;
      } else {
        player.controls = true;
        player.preload = 'metadata';
        player.setAttribute('aria-label', label);
        var source = document.createElement('source');
        source.src = trailer.video;
        source.type = trailer.type;
        player.appendChild(source);
      }
      player.className = 'access-film-trailer';
      parent.appendChild(player);
    }
  }

  function pauseTrailers(parent) {
    parent.querySelectorAll('video').forEach(function (video) { video.pause(); });
  }

  function createSessionCard(item, isOpen) {
    var card = document.createElement('article');
    card.className = 'access-session-card';
    card.dataset.sessionKey = item.programme_key || programmeKey(item);

    var main = document.createElement('div');
    main.className = 'access-session-main';
    main.appendChild(createPoster(item, 'access-session-poster'));

    var body = document.createElement('div');
    body.className = 'access-session-body';

    var title = document.createElement('h3');
    title.textContent = item.titre || 'S\u00e9ance';
    body.appendChild(title);

    var time = document.createElement('p');
    time.className = 'access-session-time';
    time.textContent = [formatDate(item.date), item.heure].filter(Boolean).join(' - ');
    body.appendChild(time);

    appendMeta(body, item);

    appendBadges(body, item.dispositifs, item.applications);

    var publicNote = getPublicNote(item);
    if (publicNote) {
      var note = document.createElement('p');
      note.className = 'access-session-note';
      note.textContent = publicNote;
      body.appendChild(note);
    }

    main.appendChild(body);
    card.appendChild(main);

    if (getSynopsis(item) || allocineURL(item) || photoURLs(item).length || trailerSource(item.trailer_url)) {
      var details = document.createElement('details');
      details.className = 'access-session-details';
      details.setAttribute('name', 'access-film');

      var summary = document.createElement('summary');
      summary.className = 'access-session-summary';
      summary.dataset.action = 'film';
      summary.setAttribute('aria-label', 'D\u00e9tails du film : ' + item.titre);
      details.appendChild(summary);

      var content = document.createElement('div');
      content.className = 'access-session-expanded';
      details.appendChild(content);
      details.addEventListener('toggle', function () {
        if (details.open) {
          container.querySelectorAll('.access-session-details[open]').forEach(function (other) {
            if (other !== details) other.open = false;
          });
          if (!content.hasChildNodes()) appendFilmDetails(content, item);
        } else {
          pauseTrailers(content);
          content.replaceChildren();
        }
      });
      card.appendChild(details);
      main.classList.add('is-expandable');
      main.addEventListener('click', function (event) {
        if (!event.target.closest('button')) {
          summary.focus({ preventScroll: true });
          summary.click();
        }
      });
      if (isOpen) details.open = true;
    }

    return card;
  }

  function renderMessage(message, isError) {
    pauseTrailers(container);
    container.textContent = '';
    var feedback = document.createElement('p');
    feedback.className = 'access-loading' + (isError ? ' access-loading--error' : '');
    feedback.textContent = message;
    container.appendChild(feedback);
  }

  function render(items) {
    if (dialog.open) {
      renderPending = true;
      return;
    }
    var opened = container.querySelector('.access-session-details[open]');
    var openKey = opened && opened.closest('.access-session-card').dataset.sessionKey;
    var active = document.activeElement;
    var activeCard = active && active.closest('.access-session-card');
    var focusedKey = activeCard && container.contains(activeCard) ? activeCard.dataset.sessionKey : null;
    pauseTrailers(container);
    container.textContent = '';
    var sessionItems = window.CineSeances.upcoming(items).filter(function (item) {
      return ['confirme', 'selon_application'].indexOf(item.statut) !== -1
        && Array.isArray(item.dispositifs) && item.dispositifs.length > 0
        && item.dispositifs.every(function (code) { return Boolean(DEVICE_LABELS[code]); });
    });

    if (!sessionItems.length) {
      renderMessage(EMPTY_MESSAGE, false);
      return;
    }

    sessionItems.forEach(function (item) {
      var key = item.programme_key || programmeKey(item);
      var card = createSessionCard(item, key === openKey);
      container.appendChild(card);
      if (key === focusedKey) {
        var action = Array.from(card.querySelectorAll('[data-action]')).find(function (el) {
          return el.dataset.action === active.dataset.action;
        });
        if (action) action.focus({ preventScroll: true });
      }
    });
  }

  setupHelpPanel();
  function readJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }

  function programmeKey(item) {
    return JSON.stringify(['titre', 'date', 'heure', 'version'].map(function (key) {
      return String(item[key] || '').trim();
    }));
  }

  function load() {
    var request = demo ? readJSON('./data/accessibilite-demo.json') :
      Promise.all([readJSON(feedURL), readJSON('./data/programme.json')])
        .then(function (values) {
          var feed = values[0];
          var programme = values[1];
          if (!feed || feed.version !== 1 || feed.timezone !== 'Europe/Paris'
              || !Array.isArray(feed.seances) || !Array.isArray(programme)) throw new Error('Invalid feed');
          var index = new Map();
          programme.forEach(function (s) {
            var key = programmeKey(s);
            index.set(key, index.has(key) ? null : s);
          });
          return feed.seances.filter(function (s) {
            return s && index.get(s.programme_key);
          }).map(function (s) {
            var current = index.get(s.programme_key);
            return Object.assign({}, s, {
              titre: current.titre, date: current.date, heure: current.heure,
              affiche: current.affiche_url, synopsis: current.synopsis,
              realisateur: current.realisateur, genre: current.genres,
              duree: current.duree_min ? current.duree_min + ' min' : '',
              pays: current.pays, acteurs_principaux: current.acteurs_principaux,
              allocine_url: allocineURL(current), backdrops: current.backdrops,
              trailer_url: current.trailer_url
            });
          });
        });
    request.then(function (items) {
      if (!Array.isArray(items)) throw new Error('Invalid sessions');
      if (hasLoaded && JSON.stringify(items) === JSON.stringify(loadedItems)) return;
      loadedItems = items;
      hasLoaded = true;
      render(loadedItems);
    }).catch(function () {
      // No fallback to fabricated demo data. A failed refresh keeps the last valid list.
      if (!hasLoaded) renderMessage(EMPTY_MESSAGE, true);
    });
  }

  dialog.querySelector('button').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (event) {
    var rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener('close', function () {
    if (dialogTrigger?.isConnected) dialogTrigger.focus({ preventScroll: true });
    dialogTrigger = null;
    if (renderPending) {
      renderPending = false;
      render(loadedItems);
    }
  });
  load();
  window.CineSeances.watchDayChange(function () { render(loadedItems); });
  window.setInterval(load, 5 * 60 * 1000);
}());
