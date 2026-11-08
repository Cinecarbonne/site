const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const helperPath = path.join(root, 'js/seances.js');
const helper = require(helperPath);
const session = (date, heure = '10:00') => ({ date, heure });

test('morning and late sessions stay all day, then disappear at Paris midnight', () => {
  const items = [session('2026-11-09'), session('2026-11-08', '23:30'),
    session('2026-11-07'), session('2026-11-08', '10:00')];
  assert.deepEqual(helper.upcoming(items, '2026-11-08T22:59:59.999Z'), [items[3], items[1], items[0]]);
  assert.deepEqual(helper.upcoming(items, '2026-11-08T23:00:00Z'), [items[0]]);
});

test('invalid dates/times are not displayed', () => {
  const items = [null, {}, session('2026-02-30'), session('2026-11-08', '25:00'),
    session('2026-11-08', ''), session('2026-11-08')];
  assert.deepEqual(helper.upcoming(items, '2026-11-08T12:00:00Z'), [items[5]]);
});

test('Paris midnight covers summer, winter and daylight saving transitions', () => {
  for (const [before, after, day, next] of [
    ['2026-07-08T21:59:59Z', '2026-07-08T22:00:00Z', '2026-07-08', '2026-07-09'],
    ['2026-03-29T21:59:59Z', '2026-03-29T22:00:00Z', '2026-03-29', '2026-03-30'],
    ['2026-10-25T22:59:59Z', '2026-10-25T23:00:00Z', '2026-10-25', '2026-10-26']]) {
    assert.equal(helper.today(before), day);
    assert.equal(helper.today(after), next);
  }
});

test('visitor timezone does not change eligibility', () => {
  for (const TZ of ['America/Los_Angeles', 'Asia/Tokyo', 'Europe/Paris']) {
    const code = `const h=require(${JSON.stringify(helperPath)});process.stdout.write(h.today('2026-11-08T23:00:00Z'))`;
    const result = spawnSync(process.execPath, ['-e', code], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '2026-11-09');
  }
});

test('open/background pages recheck midnight without fetching JSON', () => {
  let now = Date.parse('2026-11-08T22:59:59Z');
  const events = {};
  let tick, calls = 0;
  const window = { setInterval(fn) { tick = fn; }, addEventListener(k, fn) { events[k] = fn; },
    document: { addEventListener(k, fn) { events[k] = fn; } } };
  class Clock extends Date { constructor(value) { super(value === undefined ? now : value); } }
  vm.runInNewContext(fs.readFileSync(helperPath, 'utf8'), { window, Date: Clock, Intl });
  window.CineSeances.watchDayChange(() => calls++);
  tick();
  assert.equal(calls, 0);
  now += 1000;
  tick();
  assert.equal(calls, 1);
  tick();
  assert.equal(calls, 1);
  now += 86400000;
  events.visibilitychange();
  assert.equal(calls, 2);
});

test('actual programme renderer uses the shared rule', () => {
  const source = fs.readFileSync(path.join(root, 'js/carousel.js'), 'utf8');
  const fn = source.slice(source.indexOf('  function renderList(list) {'), source.indexOf('  function loadJSON()'));
  const rendered = [];
  const context = { window: { CineSeances: { upcoming: items => helper.upcoming(items, '2026-11-08T22:00:00Z') } },
    strip: { innerHTML: '', appendChild(s) { rendered.push(s); } },
    updateCalendarData() {}, calendarOverlay: null, hidePanel() {}, renderColumn: s => s,
    requestFitCaps() {}, openPanel() {} };
  vm.runInNewContext(fn + '\nrenderList(input);', { ...context,
    input: [session('2026-11-07'), session('2026-11-08')] });
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].date, '2026-11-08');
});

test('HTML loads the date helper before the programme script', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.indexOf('js/seances.js') < html.indexOf('js/carousel.js'));
});
