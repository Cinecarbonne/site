(function () {
  'use strict';

  var trigger = document.querySelector('.short-film-contest-poster-link');
  var dialog = document.getElementById('contest-poster-dialog');
  if (!trigger || !dialog || typeof dialog.showModal !== 'function') return;

  trigger.setAttribute('role', 'button');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', dialog.id);

  function openPoster() {
    if (dialog.open) return;
    dialog.showModal();
    dialog.scrollTop = 0;
    document.documentElement.classList.add('contest-poster-open');
  }

  trigger.addEventListener('click', function (event) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openPoster();
  });

  trigger.addEventListener('keydown', function (event) {
    if (event.key !== ' ') return;
    event.preventDefault();
    openPoster();
  });

  dialog.addEventListener('click', function (event) {
    if (event.target !== dialog) return;
    var bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) {
      dialog.close();
    }
  });

  dialog.addEventListener('close', function () {
    document.documentElement.classList.remove('contest-poster-open');
  });
}());
