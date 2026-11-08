(function (root) {
  'use strict';
  var formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
  });

  function today(now) {
    var parts = {};
    formatter.formatToParts(now === undefined ? new Date() : new Date(now)).forEach(function (p) {
      parts[p.type] = p.value;
    });
    return parts.year + '-' + parts.month + '-' + parts.day;
  }

  function valid(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.heure)) return false;
    var date = new Date(s.date + 'T00:00:00Z');
    return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s.date;
  }

  function upcoming(items, now) {
    var day = today(now);
    return (Array.isArray(items) ? items : []).filter(function (s) {
      return valid(s) && s.date >= day;
    }).sort(function (a, b) {
      return (a.date + a.heure).localeCompare(b.date + b.heure);
    });
  }

  function watchDayChange(callback) {
    var previous = today();
    function check() {
      var current = today();
      if (current !== previous) {
        previous = current;
        callback();
      }
    }
    // Also recheck on return from a sleeping/background tab; no network needed.
    root.setInterval(check, 1000);
    root.addEventListener('pageshow', check);
    root.document.addEventListener('visibilitychange', check);
  }

  var api = { today: today, valid: valid, upcoming: upcoming, watchDayChange: watchDayChange };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CineSeances = api;
}(typeof window === 'object' ? window : globalThis));
