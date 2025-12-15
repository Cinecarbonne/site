// assets/script.js
// Un seul JS pour toutes vos pages : menu mobile (hamburger)

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

  // Ferme le menu si on clique un lien (mobile)
  menu.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    if (window.matchMedia('(max-width: 900px)').matches) {
      setExpanded(false);
    }
  });

  // Ferme si on clique hors menu (mobile)
  document.addEventListener('click', (e) => {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    if (e.target.closest('.nav__inner')) return;
    setExpanded(false);
  });
})();
