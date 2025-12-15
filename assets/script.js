// assets/script.js — v2
// Menu burger (mobile) pour le bandeau

(function () {
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.querySelector('.nav__menu');
  if (!toggle || !menu) return;

  function setExpanded(expanded) {
    toggle.setAttribute('aria-expanded', String(expanded));
    menu.classList.toggle('is-open', expanded);
  }

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    setExpanded(!expanded);
  });

  document.addEventListener('click', (e) => {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    if (e.target.closest('.nav__inner')) return;
    setExpanded(false);
  });

  menu.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    if (window.matchMedia('(max-width: 900px)').matches) setExpanded(false);
  });
})();
