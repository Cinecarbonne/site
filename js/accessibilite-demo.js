(function () {
  'use strict';

  var container = document.getElementById('access-sessions');
  if (!container) return;
  var loadedItems = [];
  var demo = new URLSearchParams(window.location.search).get('demo') === '1';
  var feedURL = container.getAttribute('data-access-feed') || './data/accessibilite.json';

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
      if (event.key === 'Escape' && !panel.hidden) {
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
      item.className = 'access-badge access-badge--' + code;
      var application = (applications || {})[code];
      var publicLabel = device.label + (application ? ' avec ' + application : '');
      item.setAttribute('aria-label', publicLabel);

      item.appendChild(createIcon(device.icon));

      var label = document.createElement('span');
      label.textContent = publicLabel;
      item.appendChild(label);

      list.appendChild(item);
    });

    parent.appendChild(list);
  }

  function appendMeta(parent, item) {
    var infoParts = [item.version, item.duree, item.genre].filter(Boolean);
    var hasMeta = infoParts.length || item.realisateur;
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

  function createSessionCard(item, isOpen) {
    var card = document.createElement('article');
    card.className = 'access-session-card';

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

    var synopsisText = getSynopsis(item);
    if (synopsisText) {
      var details = document.createElement('details');
      details.className = 'access-session-details';
      details.setAttribute('data-session-key', item.programme_key || programmeKey(item));
      details.open = Boolean(isOpen);

      var summary = document.createElement('summary');
      summary.className = 'access-session-summary';

      var toggle = document.createElement('span');
      toggle.className = 'access-session-toggle';
      toggle.textContent = 'Synopsis';
      body.appendChild(toggle);
      summary.appendChild(main);
      details.appendChild(summary);

      var synopsis = document.createElement('p');
      synopsis.className = 'access-session-synopsis';
      synopsis.textContent = synopsisText;
      details.appendChild(synopsis);
      card.appendChild(details);
    } else {
      card.appendChild(main);
    }

    return card;
  }

  function renderMessage(message, isError) {
    container.textContent = '';
    var feedback = document.createElement('p');
    feedback.className = 'access-loading' + (isError ? ' access-loading--error' : '');
    feedback.textContent = message;
    container.appendChild(feedback);
  }

  function render(items) {
    var openKeys = new Set(Array.prototype.map.call(
      container.querySelectorAll('.access-session-details[open]'),
      function (details) { return details.getAttribute('data-session-key'); }
    ));
    var activeDetails = document.activeElement && document.activeElement.closest('.access-session-details');
    var focusedKey = activeDetails && container.contains(activeDetails)
      ? activeDetails.getAttribute('data-session-key') : null;
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
      var card = createSessionCard(item, openKeys.has(key));
      container.appendChild(card);
      if (key === focusedKey) {
        var summary = card.querySelector('summary');
        if (summary) summary.focus({ preventScroll: true });
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
              duree: current.duree_min ? current.duree_min + ' min' : ''
            });
          });
        });
    request.then(function (items) {
      if (!Array.isArray(items)) throw new Error('Invalid sessions');
      loadedItems = items;
      render(loadedItems);
    }).catch(function () {
      // No fallback to fabricated demo data. A failed refresh keeps the last valid list.
      if (loadedItems.length) render(loadedItems);
      else renderMessage(EMPTY_MESSAGE, true);
    });
  }

  load();
  window.CineSeances.watchDayChange(function () { render(loadedItems); });
  window.setInterval(load, 5 * 60 * 1000);
}());
