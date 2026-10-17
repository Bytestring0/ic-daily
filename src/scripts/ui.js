const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const base = document.body.dataset.base || '';
const persist = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/* ---------- 阅读 / 简洁 模式切换 ---------- */
function syncMode() {
  const current = document.documentElement.dataset.mode || 'reading';
  $$('button[data-mode]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === current)),
  );
}
syncMode();

$$('button[data-mode]').forEach((button) =>
  button.addEventListener('click', () => {
    document.documentElement.dataset.mode = button.dataset.mode;
    persist('ic-mode', button.dataset.mode);
    syncMode();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }),
);

/* ---------- 明暗主题 ---------- */
$('#theme-toggle')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  persist('ic-theme', next);
});

/* ---------- 侧栏折叠 ---------- */
const mobile = () => window.matchMedia('(max-width: 760px)').matches;
function syncRail() {
  $('#rail-toggle')?.setAttribute(
    'aria-expanded',
    String(mobile() ? document.body.classList.contains('rail-mobile-open') : !document.body.classList.contains('rail-collapsed')),
  );
}
syncRail();
window.addEventListener('resize', syncRail);
$('#rail-toggle')?.addEventListener('click', () => {
  document.body.classList.toggle(mobile() ? 'rail-mobile-open' : 'rail-collapsed');
  syncRail();
});
document.addEventListener('click', (e) => {
  if (mobile() && !e.target.closest('.left-rail, #rail-toggle')) {
    document.body.classList.remove('rail-mobile-open');
    syncRail();
  }
});

/* ---------- 日历 ---------- */
const calendar = $('.calendar');
if (calendar) {
  const selected = calendar.dataset.date;
  const available = new Set(JSON.parse(calendar.dataset.editions));
  let [year, month] = selected.split('-').map(Number);
  function renderCalendar() {
    $('#calendar-title').textContent = `${year} 年 ${month} 月`;
    const days = $('#calendar-days');
    days.replaceChildren();
    const offset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) days.append(document.createElement('span'));
    for (let day = 1; day <= new Date(year, month, 0).getDate(); day++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const hasEdition = available.has(date);
      const el = document.createElement(hasEdition ? 'a' : 'span');
      el.textContent = day;
      if (hasEdition) {
        el.href = `${base}/edition/${date}/`;
        el.setAttribute('aria-label', `${date} 简报`);
      } else el.className = 'no-edition';
      if (date === selected && hasEdition) {
        el.classList.add('current');
        el.setAttribute('aria-current', 'date');
      }
      days.append(el);
    }
  }
  $('#prev-month').addEventListener('click', () => { if (--month < 1) { month = 12; year--; } renderCalendar(); });
  $('#next-month').addEventListener('click', () => { if (++month > 12) { month = 1; year++; } renderCalendar(); });
  renderCalendar();
}

/* ---------- 对话框基础行为 ---------- */
$$('[data-close]').forEach((b) =>
  b.addEventListener('click', () => document.getElementById(b.dataset.close).close()),
);
$$('dialog').forEach((dialog) =>
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  }),
);

/* ---------- 搜索 ---------- */
const searchData = JSON.parse($('#search-data').textContent);
function renderSearch() {
  const term = $('#search-input').value.trim().toLocaleLowerCase();
  const matches = term
    ? searchData.filter((e) =>
        `${e.title} ${e.summary} ${e.category} ${e.date}`.toLocaleLowerCase().includes(term),
      )
    : [];
  const results = $('#search-results');
  results.replaceChildren();
  if (!matches.length) {
    const p = document.createElement('p');
    p.className = 'search-empty';
    p.textContent = term ? '没有匹配的内容' : `已收录 ${searchData.length} 条动态`;
    results.append(p);
    return;
  }
  for (const entry of matches.slice(0, 50)) {
    const link = document.createElement('a');
    link.className = 'search-result';
    link.href = entry.href;
    const title = document.createElement('strong');
    title.textContent = entry.title;
    const meta = document.createElement('small');
    meta.textContent = `${entry.date} · ${entry.category}`;
    link.append(title, meta);
    results.append(link);
  }
}
function openSearch() {
  $('#search-dialog').showModal();
  renderSearch();
  $('#search-input').focus();
}
$$('[data-search-open]').forEach((b) => b.addEventListener('click', openSearch));
$('#search-input')?.addEventListener('input', renderSearch);
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (!$('#search-dialog').open) openSearch();
  }
});

/* ---------- 目录高亮 ---------- */
const tocLinks = $$('.contents-rail a[href^="#"], .simple-categories a');
if (tocLinks.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      const hit = entries.find((e) => e.isIntersecting);
      if (!hit) return;
      tocLinks.forEach((a) => a.classList.toggle('active', a.hash === `#${hit.target.id}`));
    },
    { rootMargin: '-90px 0px -65% 0px' },
  );
  $$('#overview, .entry-group, .entry').forEach((el) => observer.observe(el));
}
