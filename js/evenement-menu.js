(function () {
  'use strict';

  var menu = document.querySelector('.event-jump-nav');
  if (!menu) return;

  var main = menu.parentElement;
  var links = Array.from(menu.querySelectorAll('.event-jump-link[href^="#"]'));

  function select(id, updateUrl) {
    var link = links.find(function (item) { return item.getAttribute('href') === '#' + id; });
    var section = document.getElementById(id);
    if (!link || !section || section.parentElement !== main) return false;

    main.insertBefore(section, menu.nextElementSibling);
    links.forEach(function (item) {
      if (item === link) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });

    if (updateUrl) history.replaceState(history.state, '', link.getAttribute('href'));
    return true;
  }

  links.forEach(function (link) {
    link.addEventListener('click', function (event) {
      var id = link.getAttribute('href').slice(1);
      if (!select(id, true)) return;
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  });

  var initialId = window.location.hash.slice(1);
  if (initialId && select(initialId, false)) {
    requestAnimationFrame(function () { window.scrollTo({ top: 0, behavior: 'auto' }); });
  }

  window.addEventListener('hashchange', function () {
    select(window.location.hash.slice(1), false);
  });
}());
