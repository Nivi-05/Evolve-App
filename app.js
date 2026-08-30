(function () {
'use strict';
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

// ---------------- toast ----------------
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------------- generic bottom sheet ----------------
function openSheet(html, onOpen) {
  $('#sheetBody').innerHTML = html;
  $('#sheetOverlay').classList.add('open');
  if (onOpen) onOpen($('#sheetBody'));
}
function closeSheet() {
  $('#sheetOverlay').classList.remove('open');
}
$('#sheetOverlay').addEventListener('click', (e) => { if (e.target.id === 'sheetOverlay') closeSheet(); });

// ---------------- nav / screen switching ----------------
const screens = {
  today: 'screen-today', journey: 'screen-journey', rewards: 'screen-rewards',
  budget: 'screen-budget', stats: 'screen-stats',
  settings: 'screen-settings', 'settings-detail': 'screen-settings-detail',
};

function showScreen(key) {
  Object.values(screens).forEach(id => $('#' + id).classList.remove('active'));
  $('#' + screens[key]).classList.add('active');
  const isPrimary = ['today', 'journey', 'rewards', 'budget', 'stats'].includes(key);
  $('#navWrap').style.display = isPrimary ? '' : 'none';
  if (isPrimary) {
    $$('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === key));
    moveIndicator($('.nav-tab.active'));
  }
}

function moveIndicator(tab) {
  if (!tab) return;
  const barRect = tab.parentElement.getBoundingClientRect();
  const tabRect = tab.getBoundingClientRect();
  const indicator = $('#navIndicator');
  indicator.style.width = tabRect.width + 'px';
  indicator.style.transform = `translateX(${tabRect.left - barRect.left - 8}px)`;
}

$$('.nav-tab').forEach(tab => {
  tab.addEventListener('click', async () => {
    tab.classList.add('tapping');
    setTimeout(() => tab.classList.remove('tapping'), 180);
    showScreen(tab.dataset.tab);
    if (tab.dataset.tab === 'today') await renderToday();
    if (tab.dataset.tab === 'journey') await renderJourney();
    if (tab.dataset.tab === 'rewards') await renderRewards();
    if (tab.dataset.tab === 'budget') await renderBudget();
    if (tab.dataset.tab === 'stats') await renderStats();
  });
});

$('#settingsFab').addEventListener('click', () => { showScreen('settings'); renderSettingsList(); });
$('#settingsBackBtn').addEventListener('click', () => { showScreen('settings'); renderSettingsList(); });

// ======================================================================
// TODAY
// ======================================================================
let expandedCategories = new Set();
let currentQuestTab = 'daily';
$('#addHabitBtn').addEventListener('click', () => openAddHabitSheet());

async function renderToday() {
  const info = await R66.getTodayInfo();
  $('#dayCount').textContent = `Day ${info.dayNumber}`;
  $('#chapterBadge').textContent = `Chapter ${info.chapter}`;
  const now = R66.getEffectiveNow();
  const hour = now.getHours();
  $('#greetingText').textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('#todayDateText').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const balance = await R66.getXPBalance();
  const levelInfo = R66.levelForXP(balance);
  $('#levelBadge').textContent = `Lv ${levelInfo.level}`;

  await maybeShowMilestone(info);

  const categories = await R66.listCategories();
  const allHabits = await R66.listHabits();
  await renderWeeklyGoals(allHabits);
  await renderOnceGoals(allHabits, info);
  applyQuestTabVisibility();

  const catsEl = $('#categories');
  catsEl.innerHTML = '';

  let totalDue = 0, totalDone = 0;

  const activeCats = [];
  for (const cat of categories) {
    const catHabits = allHabits.filter(h => h.categoryId === cat.id && h.active !== false && R66.isHabitDueOn(h, info.dateKey));
    if (catHabits.length === 0) continue;
    activeCats.push({ cat, catHabits });
  }

  if (activeCats.length === 0 && allHabits.filter(h => h.active !== false).length === 0) {
    catsEl.innerHTML = `
      <div class="empty-state">
        <div class="icon">🌱</div>
        <h3>Nothing here yet</h3>
        <p>Add the first thing you want to build. You can always add more later.</p>
        <button class="primary-btn" id="emptyAddHabitBtn">Add a habit</button>
      </div>`;
    $('#emptyAddHabitBtn').addEventListener('click', openAddHabitSheet);
    $('#addHabitBtn').style.display = 'none';
    updateProgressCard(0, 0, info);
    return;
  }
  $('#addHabitBtn').style.display = '';

  for (const { cat, catHabits } of activeCats) {
    const doneList = [];
    for (const h of catHabits) doneList.push(await R66.isHabitDone(h.id, info.dateKey));
    const doneCount = doneList.filter(Boolean).length;
    totalDue += catHabits.length; totalDone += doneCount;

    const isExpanded = expandedCategories.has(cat.id);
    const fully = doneCount === catHabits.length;
    const card = document.createElement('div');
    card.className = 'category-card' + (isExpanded ? ' expanded' : '') + (fully ? ' done-fully' : '');
    card.innerHTML = `
      <div class="category-header" data-key="${cat.id}">
        <div class="icon-chip" style="background:${categoryGradient(cat.colorKey)}">${cat.icon}</div>
        <div class="name-col">
          <span class="cat-name">${escapeHtml(cat.name)}</span>
          <div class="mini-track"><div class="mini-fill" style="width:${Math.round((doneCount / catHabits.length) * 100)}%; background:${categoryColor(cat.colorKey)}"></div></div>
        </div>
        <span class="cat-count">${doneCount}/${catHabits.length}</span>
        <span class="cat-arrow">▸</span>
      </div>
      <div class="habit-list"></div>`;
    catsEl.appendChild(card);

    const list = $('.habit-list', card);
    catHabits.forEach((h, i) => {
      const done = doneList[i];
      const row = document.createElement('div');
      row.className = 'habit-row';
      const xp = (typeof h.xpValue === 'number' && h.xpValue > 0) ? h.xpValue : 10;
      row.innerHTML = `
        <div class="checkbox ${done ? 'done' : ''}" data-habit="${h.id}">
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 12.5L9.5 18L20 6" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <span class="habit-label ${done ? 'done' : ''}">${escapeHtml(h.name)}</span>
        <span class="habit-xp-badge">${xp}</span>
        <button class="habit-menu-btn" data-edit="${h.id}">⋯</button>`;
      list.appendChild(row);
    });

    if (isExpanded) requestAnimationFrame(() => { list.style.maxHeight = list.scrollHeight + 'px'; });
  }

  if (totalDue > 0 && totalDone === totalDue) {
    const note = document.createElement('div');
    note.className = 'all-done-note';
    note.textContent = "That's everything for today.";
    catsEl.appendChild(note);
  }
  if (activeCats.length === 0 && allHabits.filter(h => h.active !== false).length > 0) {
    const note = document.createElement('div');
    note.className = 'empty-inline show';
    note.textContent = "Nothing daily due today — check Weekly or 66-Day above.";
    catsEl.appendChild(note);
  }

  attachTodayHandlers(info);
  updateProgressCard(totalDone, totalDue, info);
}

function categoryColor(key) {
  const map = { mind: '#9C8CE0', study: '#7FA7E8', body: '#E8A98F', health: '#8FCBD9', career: '#D9A6AE', finance: '#E3C48F', social: '#E6A9C4', personal: '#B6A0DE', growth: '#8E8FDB' };
  return map[key] || '#9C8CE0';
}
const CATEGORY_PALETTE_KEYS = ['mind', 'study', 'body', 'health', 'career', 'finance', 'social', 'personal', 'growth'];
function pickNextColorKey(existingCats) {
  const used = new Set(existingCats.map(c => c.colorKey));
  const free = CATEGORY_PALETTE_KEYS.find(k => !used.has(k));
  if (free) return free;
  let hash = 0;
  for (const c of existingCats) hash = (hash + c.name.length * 7 + c.name.charCodeAt(0)) | 0;
  return CATEGORY_PALETTE_KEYS[Math.abs(hash) % CATEGORY_PALETTE_KEYS.length];
}
function categoryGradient(key) {
  const c = categoryColor(key);
  return `linear-gradient(135deg, ${c}, ${c}CC)`;
}
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

function updateProgressCard(done, total, info) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('#progressLabel').textContent = `${done} of ${total} done`;
  $('#progressPct').textContent = `${pct}%`;
  $('#progressFill').style.width = pct + '%';
  $('#progressCaption').textContent = total === 0 ? 'Add a habit to get started.' : pct === 0 ? "Let's get started." : pct === 100 ? "That's everything for today." : pct >= 80 ? 'Almost there.' : 'Good momentum.';
  if (pct === 100 && total > 0) {
    const card = $('#progressCard');
    card.classList.remove('celebrate'); void card.offsetWidth; card.classList.add('celebrate');
  }
}

function attachTodayHandlers(info) {
  $$('.category-header').forEach(header => {
    header.addEventListener('click', () => {
      const id = header.dataset.key;
      const card = header.closest('.category-card');
      const list = $('.habit-list', card);
      if (expandedCategories.has(id)) {
        list.style.maxHeight = list.scrollHeight + 'px';
        requestAnimationFrame(() => { list.style.maxHeight = '0px'; });
        expandedCategories.delete(id); card.classList.remove('expanded');
      } else {
        expandedCategories.add(id); card.classList.add('expanded');
        requestAnimationFrame(() => { list.style.maxHeight = list.scrollHeight + 'px'; });
      }
    });
  });

  $$('.checkbox').forEach(box => {
    box.addEventListener('click', async (e) => {
      e.stopPropagation();
      const habitId = box.dataset.habit;
      const result = await R66.toggleHabitCompletion(habitId, info.dateKey);
      box.classList.toggle('done', result.nowDone);
      box.classList.remove('pulse'); void box.offsetWidth; box.classList.add('pulse');
      const label = box.parentElement.querySelector('.habit-label');
      label.classList.toggle('done', result.nowDone);
      if (result.nowDone) {
        const chip = document.createElement('span');
        chip.className = 'xp-chip show';
        chip.textContent = `+${result.xpValue} XP`;
        box.parentElement.appendChild(chip);
        setTimeout(() => chip.remove(), 950);
      }
      await renderToday();
    });
  });

  $$('[data-edit]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const habit = (await R66.listHabits()).find(h => h.id === btn.dataset.edit);
      openAddHabitSheet(habit);
    });
  });
}

async function renderWeeklyGoals(allHabits) {
  const weeklyHabits = allHabits.filter(h => h.active !== false && h.frequency && h.frequency.type === 'weekly');
  const container = $('#weeklyGoals');
  container.innerHTML = '';
  if (weeklyHabits.length === 0) {
    container.innerHTML = `<div class="empty-inline show">No weekly goals yet — things like "talk to 4 friends" or "do laundry 2×" work well here. Add one with the button below.</div>`;
    return;
  }

  const weekRange = R66.getWeekRange(R66.getEffectiveNow());
  const header = document.createElement('div');
  header.className = 'weekly-goals-head';
  header.textContent = 'This week';
  container.appendChild(header);

  for (const h of weeklyHabits) {
    const count = await R66.getWeeklyProgress(h.id, weekRange);
    const target = h.frequency.timesPerWeek;
    const pct = Math.min(100, Math.round((count / target) * 100));
    const done = count >= target;
    const row = document.createElement('div');
    row.className = 'weekly-goal-row' + (done ? ' done' : '');
    row.innerHTML = `
      <div class="weekly-goal-top">
        <span class="weekly-goal-name">${escapeHtml(h.name)}</span>
        <button class="habit-menu-btn" data-edit="${h.id}">⋯</button>
      </div>
      <div class="weekly-goal-track"><div class="weekly-goal-fill" style="width:${pct}%"></div></div>
      <div class="weekly-goal-bottom">
        <span class="weekly-goal-count">${count} of ${target} this week</span>
        <div class="weekly-goal-btns">
          <button class="wg-btn wg-minus" data-undo="${h.id}" ${count === 0 ? 'disabled' : ''}>−</button>
          <button class="wg-btn wg-plus" data-log="${h.id}" ${done ? 'disabled' : ''}>+1</button>
        </div>
      </div>`;
    container.appendChild(row);
  }

  $$('[data-log]', container).forEach(btn => {
    btn.addEventListener('click', async () => {
      const result = await R66.logWeeklyProgress(btn.dataset.log);
      toast(`+${result.xpValue} XP`);
      await renderToday();
    });
  });
  $$('[data-undo]', container).forEach(btn => {
    btn.addEventListener('click', async () => {
      await R66.undoLastWeeklyLog(btn.dataset.undo, weekRange);
      await renderToday();
    });
  });
  $$('[data-edit]', container).forEach(btn => {
    btn.addEventListener('click', async () => {
      const habit = (await R66.listHabits()).find(x => x.id === btn.dataset.edit);
      openAddHabitSheet(habit);
    });
  });
}

function applyQuestTabVisibility() {
  $('#categories').style.display = currentQuestTab === 'daily' ? '' : 'none';
  $('#weeklyGoals').style.display = currentQuestTab === 'weekly' ? '' : 'none';
  $('#onceGoals').style.display = currentQuestTab === 'once' ? '' : 'none';
  $$('.quest-tab').forEach(t => t.classList.toggle('active', t.dataset.quest === currentQuestTab));
}

$$('.quest-tab').forEach(btn => {
  btn.addEventListener('click', async () => {
    currentQuestTab = btn.dataset.quest;
    applyQuestTabVisibility();
  });
});

async function renderOnceGoals(allHabits, info) {
  const onceHabits = allHabits.filter(h => h.active !== false && h.frequency && h.frequency.type === 'once');
  const container = $('#onceGoals');
  container.innerHTML = '';
  if (onceHabits.length === 0) {
    container.innerHTML = `<div class="empty-inline show">One-off things across your whole 66 days — like "Dentist appointment, Day 40" — show up here, sorted by how soon they're coming up.</div>`;
    return;
  }

  const sorted = [...onceHabits].sort((a, b) => a.frequency.date.localeCompare(b.frequency.date));
  const todayKey = info.dateKey;

  for (const h of sorted) {
    const dateKey = h.frequency.date;
    const done = await R66.isHabitDone(h.id, dateKey);
    const diffDays = R66.daysBetween(new Date(todayKey + 'T00:00:00'), new Date(dateKey + 'T00:00:00'));
    let when, whenClass = '';
    if (dateKey === todayKey) { when = 'Today'; whenClass = 'soon'; }
    else if (diffDays > 0) { when = diffDays === 1 ? 'Tomorrow' : `In ${diffDays} days`; whenClass = diffDays <= 3 ? 'soon' : ''; }
    else { when = diffDays === -1 ? 'Yesterday' : `${-diffDays} days ago`; whenClass = done ? '' : 'past'; }

    const row = document.createElement('div');
    row.className = 'once-goal-row' + (done ? ' done' : '');
    row.innerHTML = `
      <div class="once-goal-check ${done ? 'done' : ''}" data-toggle-once="${h.id}" data-date="${dateKey}">
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 12.5L9.5 18L20 6" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="once-goal-info">
        <div class="once-goal-name ${done ? 'done' : ''}">${escapeHtml(h.name)}</div>
        <div class="once-goal-when ${whenClass}">${when}</div>
      </div>
      <button class="habit-menu-btn" data-edit="${h.id}">⋯</button>`;
    container.appendChild(row);
  }

  $$('[data-toggle-once]', container).forEach(box => {
    box.addEventListener('click', async () => {
      const result = await R66.toggleHabitCompletion(box.dataset.toggleOnce, box.dataset.date);
      if (result.nowDone) toast(`+${result.xpValue} XP`);
      await renderToday();
    });
  });
  $$('[data-edit]', container).forEach(btn => {
    btn.addEventListener('click', async () => {
      const habit = (await R66.listHabits()).find(x => x.id === btn.dataset.edit);
      openAddHabitSheet(habit);
    });
  });
}

async function openAddHabitSheet(existingHabit) {
  const cats = await R66.listCategories();
  const isEdit = !!(existingHabit && existingHabit.id);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const selectedDays = (isEdit && existingHabit.frequency && existingHabit.frequency.type === 'custom') ? existingHabit.frequency.days : null;
  const isOnce = isEdit && existingHabit.frequency && existingHabit.frequency.type === 'once';
  const onceDate = isOnce ? existingHabit.frequency.date : null;
  const isWeekly = isEdit && existingHabit.frequency && existingHabit.frequency.type === 'weekly';
  const timesPerWeek = isWeekly ? existingHabit.frequency.timesPerWeek : 3;
  const todayInfo = await R66.getTodayInfo();
  const existingXp = isEdit && typeof existingHabit.xpValue === 'number' ? existingHabit.xpValue : 10;

  openSheet(`
    <h3>${isEdit ? 'Edit habit' : 'New habit'}</h3>
    <div class="field-label">What do you want to do?</div>
    <input class="text-input" id="habitNameInput" placeholder="e.g. Morning meditation" value="${isEdit ? escapeHtml(existingHabit.name) : ''}">
    <div class="error-text" id="habitNameError">Give it a name.</div>

    <div class="field-label">Category</div>
    <div class="chip-row" id="categoryChips">
      ${cats.map(c => `<div class="chip ${isEdit && existingHabit.categoryId === c.id ? 'selected' : ''}" data-cat="${c.id}">${escapeHtml(c.name)}</div>`).join('')}
      <div class="chip" id="newCategoryChip">+ New category</div>
    </div>
    <div id="newCategoryField" style="display:none; margin-top:8px;">
      <input class="text-input" id="newCategoryName" placeholder="Category name">
    </div>

    <div class="field-label">Frequency</div>
    <div class="chip-row">
      <div class="chip" id="freqDaily">Daily</div>
      <div class="chip" id="freqCustom">Custom days</div>
      <div class="chip" id="freqOnce">Just one day</div>
      <div class="chip" id="freqWeekly">Weekly goal</div>
    </div>
    <div class="day-toggle-row" id="dayToggles" style="display:none; margin-top:10px;">
      ${dayNames.map((d, i) => `<button class="day-toggle" data-day="${i}">${d[0]}</button>`).join('')}
    </div>
    <div style="display:none; margin-top:10px;" id="onceDateField">
      <input class="text-input" id="onceDateInput" type="date" value="${onceDate || todayInfo.dateKey}">
    </div>
    <div style="display:none; margin-top:10px;" id="weeklyGoalField">
      <div class="field-label" style="margin-top:0;">How many times a week?</div>
      <input class="text-input" id="timesPerWeekInput" type="number" min="1" max="14" inputmode="numeric" value="${timesPerWeek}">
      <div class="hint-text">e.g. "Talk to friends" 4×/week, or "Do laundry" 2×/week — resets every Monday.</div>
    </div>

    <div class="field-label">How many points is it worth?</div>
    <div class="chip-row" id="xpChips">
      ${[2, 5, 10, 15, 20].map(v => `<div class="chip ${existingXp === v ? 'selected' : ''}" data-xp="${v}">${v}</div>`).join('')}
    </div>
    <div class="hint-text">Small habits (like taking a vitamin) can be worth less than bigger ones.</div>

    <div class="field-label">Reminder (optional)</div>
    <input class="text-input" id="reminderInput" type="time" value="${isEdit && existingHabit.reminderTime ? existingHabit.reminderTime : ''}">

    <div class="sheet-actions">
      ${isEdit ? '<button class="secondary-btn" id="deleteHabitBtn" style="color:var(--danger);">Delete</button>' : '<button class="secondary-btn" id="cancelHabitBtn">Cancel</button>'}
      <button class="primary-btn" id="saveHabitBtn">${isEdit ? 'Save changes' : 'Add it'}</button>
    </div>
  `, (root) => {
    let selectedCat = isEdit ? existingHabit.categoryId : (cats[0] && cats[0].id) || null;
    let freqType = isWeekly ? 'weekly' : isOnce ? 'once' : (selectedDays ? 'custom' : 'daily');
    let days = new Set(selectedDays || []);
    let xpValue = [2, 5, 10, 15, 20].includes(existingXp) ? existingXp : 10;
    if (!isEdit || ![2, 5, 10, 15, 20].includes(existingXp)) {
      $$('.chip[data-xp]', root).forEach(c => c.classList.toggle('selected', +c.dataset.xp === xpValue));
    }

    $$('.chip[data-cat]', root).forEach(chip => chip.addEventListener('click', () => {
      $$('.chip[data-cat]', root).forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      selectedCat = chip.dataset.cat;
      $('#newCategoryField', root).style.display = 'none';
    }));
    $('#newCategoryChip', root).addEventListener('click', () => {
      $$('.chip[data-cat]', root).forEach(c => c.classList.remove('selected'));
      selectedCat = null;
      $('#newCategoryField', root).style.display = '';
    });

    $$('.chip[data-xp]', root).forEach(chip => chip.addEventListener('click', () => {
      $$('.chip[data-xp]', root).forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      xpValue = +chip.dataset.xp;
    }));

    function setFreq(t) {
      freqType = t;
      $('#freqDaily', root).classList.toggle('selected', t === 'daily');
      $('#freqCustom', root).classList.toggle('selected', t === 'custom');
      $('#freqOnce', root).classList.toggle('selected', t === 'once');
      $('#freqWeekly', root).classList.toggle('selected', t === 'weekly');
      $('#dayToggles', root).style.display = t === 'custom' ? '' : 'none';
      $('#onceDateField', root).style.display = t === 'once' ? '' : 'none';
      $('#weeklyGoalField', root).style.display = t === 'weekly' ? '' : 'none';
    }
    setFreq(freqType);
    $('#freqDaily', root).addEventListener('click', () => setFreq('daily'));
    $('#freqCustom', root).addEventListener('click', () => setFreq('custom'));
    $('#freqOnce', root).addEventListener('click', () => setFreq('once'));
    $('#freqWeekly', root).addEventListener('click', () => setFreq('weekly'));
    $$('.day-toggle', root).forEach(btn => {
      const d = +btn.dataset.day;
      if (days.has(d)) btn.classList.add('selected');
      btn.addEventListener('click', () => {
        if (days.has(d)) { days.delete(d); btn.classList.remove('selected'); }
        else { days.add(d); btn.classList.add('selected'); }
      });
    });

    if (!isEdit) $('#cancelHabitBtn', root).addEventListener('click', closeSheet);
    if (isEdit) $('#deleteHabitBtn', root).addEventListener('click', async () => {
      if (!confirm(`Delete "${existingHabit.name}"? Your history with it stays in your stats.`)) return;
      await R66.softDeleteHabit(existingHabit.id);
      closeSheet(); toast('Habit deleted'); await renderToday();
    });

    $('#saveHabitBtn', root).addEventListener('click', async () => {
      const nameInput = $('#habitNameInput', root);
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.classList.add('invalid'); $('#habitNameError', root).classList.add('show'); return;
      }
      let categoryId = selectedCat;
      if (!categoryId) {
        const newName = $('#newCategoryName', root).value.trim();
        if (!newName) { toast('Choose or create a category'); return; }
        const newCat = await R66.createCategory(newName, pickNextColorKey(cats));
        categoryId = newCat.id;
      }
      let frequency;
      if (freqType === 'daily') frequency = { type: 'daily' };
      else if (freqType === 'once') {
        const dateVal = $('#onceDateInput', root).value;
        if (!dateVal) { toast('Pick a date'); return; }
        frequency = { type: 'once', date: dateVal };
      } else if (freqType === 'weekly') {
        const n = parseInt($('#timesPerWeekInput', root).value, 10) || 1;
        frequency = { type: 'weekly', timesPerWeek: Math.max(1, Math.min(14, n)) };
      } else {
        if (days.size === 0) { toast('Pick at least one day'); return; }
        frequency = { type: 'custom', days: Array.from(days).sort() };
      }
      const reminderTime = $('#reminderInput', root).value || null;

      if (isEdit) await R66.updateHabit(existingHabit.id, { name, categoryId, frequency, reminderTime, xpValue });
      else await R66.createHabit({ name, categoryId, frequency, reminderTime, xpValue });

      if (categoryId) expandedCategories.add(categoryId);
      closeSheet();
      await renderToday();
    });
  });
}

// ======================================================================
// ======================================================================
// MILESTONE (Day 66 -> Chapter 2)
// ======================================================================
const MILESTONE_META = [
  { name: 'First Steps', icon: '🌱', xp: 40 },
  { name: 'Building Momentum', icon: '🔥', xp: 40 },
  { name: 'Halfway Hero', icon: '⭐', xp: 60 },
  { name: 'Almost There', icon: '💪', xp: 60 },
  { name: 'Chapter Complete', icon: '🏆', xp: 150 },
];

async function checkMilestoneAwards(info) {
  const milestonesTotal = MILESTONE_META.length;
  const milestonesDone = Math.min(milestonesTotal, Math.floor(R66.dayInChapter(info.dayNumber) / (R66.CHAPTER_LENGTH / milestonesTotal)));
  let record = await R66.getMilestoneAwards();
  if (record.chapter !== info.chapter) record = { chapter: info.chapter, awarded: [] };

  const newlyAwarded = [];
  for (let i = 1; i <= milestonesDone; i++) {
    if (!record.awarded.includes(i)) {
      const meta = MILESTONE_META[i - 1];
      await R66.addBadge({ chapter: info.chapter, milestoneIndex: i, name: meta.name, icon: meta.icon, xp: meta.xp });
      await R66.addXPBonus(meta.xp, `Milestone: ${meta.name}`);
      record.awarded.push(i);
      newlyAwarded.push({ index: i, ...meta });
    }
  }
  if (newlyAwarded.length > 0) await R66.setMilestoneAwards(record.chapter, record.awarded);
  return newlyAwarded;
}

function showBadgePopup(badge) {
  openSheet(`
    <div class="badge-popup-icon">${badge.icon}</div>
    <div class="badge-popup-title">Badge earned</div>
    <div class="badge-popup-name">${escapeHtml(badge.name)}</div>
    <div class="badge-popup-xp">+${badge.xp} XP bonus</div>
    <button class="primary-btn" id="closeBadgePopup" style="width:100%;">Nice!</button>
  `, (root) => {
    $('#closeBadgePopup', root).addEventListener('click', closeSheet);
  });
}

async function maybeShowMilestone(info) {
  const user = await R66.getUser();
  const newlyAwarded = await checkMilestoneAwards(info);
  const chapterBadge = newlyAwarded.find(b => b.index === MILESTONE_META.length);

  if (info.dayNumber >= R66.CHAPTER_LENGTH && !user.chapter1CelebrationShown) {
    if (chapterBadge) {
      $('#milestoneBadgeLine').innerHTML = `<span class="mb-icon">${chapterBadge.icon}</span><span>${escapeHtml(chapterBadge.name)} badge earned · +${chapterBadge.xp} XP</span>`;
    }
    showMilestone();
    return;
  }
  // Lighter celebration for mid-chapter milestones (1–4). Chapter-complete (5)
  // is folded into the full-screen celebration above instead of a popup.
  const smallBadges = newlyAwarded.filter(b => b.index !== MILESTONE_META.length);
  if (smallBadges.length > 0) showBadgePopup(smallBadges[smallBadges.length - 1]);
}
function showMilestone() {
  const screen = $('#milestoneScreen');
  const particlesWrap = $('#milestoneParticles');
  particlesWrap.innerHTML = '';
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = (5 + Math.random() * 90) + '%';
    p.style.bottom = (Math.random() * 30) + '%';
    p.style.animationDelay = (Math.random() * 0.6) + 's';
    particlesWrap.appendChild(p);
  }
  screen.classList.add('open');
}
$('#continueChapter2Btn').addEventListener('click', async () => {
  await R66.updateUser({ chapter1CelebrationShown: true });
  $('#milestoneScreen').classList.remove('open');
  await renderToday();
});

// ======================================================================
// JOURNEY
// ======================================================================
async function renderJourney() {
  const info = await R66.getTodayInfo();
  const user = await R66.getUser();

  $('#journeyHeroDay').textContent = `Day ${info.dayNumber}`;
  const pctThroughChapter = R66.dayInChapter(info.dayNumber) / R66.CHAPTER_LENGTH;
  $('#journeyHeroTagline').textContent = pctThroughChapter >= 0.9
    ? "You're almost there — the finish line is close."
    : pctThroughChapter >= 0.5
      ? "You're on your way to becoming unstoppable."
      : "Every step counts. Keep going.";

  const milestonesTotal = 5;
  const milestonesDone = Math.min(milestonesTotal, Math.floor(R66.dayInChapter(info.dayNumber) / (R66.CHAPTER_LENGTH / milestonesTotal)));
  $('#milestoneCount').textContent = `${milestonesDone} / ${milestonesTotal} completed`;
  const milestonesRow = $('#milestonesRow');
  milestonesRow.innerHTML = '';
  for (let i = 1; i <= milestonesTotal; i++) {
    const done = i <= milestonesDone;
    const dot = document.createElement('div');
    dot.className = 'milestone-dot ' + (done ? 'done' : 'locked');
    dot.innerHTML = done
      ? '<svg viewBox="0 0 24 24" fill="none"><path d="M4 12.5L9.5 18L20 6" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2" stroke="#8B81A8" stroke-width="2"/><path d="M8 10V7a4 4 0 018 0v3" stroke="#8B81A8" stroke-width="2"/></svg>';
    milestonesRow.appendChild(dot);
  }

  const streaks = await R66.computeStreaks();
  $('#journeyCurrentStreak').textContent = `${streaks.current} day${streaks.current === 1 ? '' : 's'}`;
  $('#journeyLongestStreak').textContent = `${streaks.longest} day${streaks.longest === 1 ? '' : 's'}`;

  const track = $('#journeyTrack');
  track.innerHTML = '';
  const line = document.createElement('div'); line.className = 'journey-line'; track.appendChild(line);

  const startDay = Math.max(1, info.dayNumber - 13);
  let lastChapterShown = null;

  for (let d = startDay; d <= info.dayNumber; d++) {
    const chapter = R66.chapterFor(d);
    if (chapter !== lastChapterShown) {
      const marker = document.createElement('div');
      marker.className = 'chapter-marker';
      marker.textContent = `Chapter ${chapter} · Days ${(chapter - 1) * R66.CHAPTER_LENGTH + 1}–${chapter * R66.CHAPTER_LENGTH}`;
      track.appendChild(marker);
      lastChapterShown = chapter;
    }

    const dayDate = new Date(user.challengeStartDate);
    dayDate.setDate(dayDate.getDate() + (d - 1));
    const dateKey = R66.dateKeyOf(dayDate);
    const completions = await R66.getCompletionsForDate(dateKey);
    const doneCount = completions.filter(c => c.completed).length;
    const isMilestone = R66.isMilestoneDay(d);
    const isCurrent = d === info.dayNumber;

    let state;
    if (isCurrent) state = 'current';
    else if (isMilestone) state = 'milestone';
    else if (doneCount === 0) state = 'missed';
    else state = 'complete';

    const row = document.createElement('div');
    row.className = 'journey-node-row';
    row.dataset.dateKey = dateKey; row.dataset.dayNum = d;
    const label = isCurrent ? 'Today' : `Day ${d}`;

    row.innerHTML = `
      <div class="jnode-col"><div class="jnode ${state}">${isMilestone ? '★' : d}</div></div>
      <div><div class="jnode-label"><b>${label}</b></div></div>`;
    track.appendChild(row);
  }

  $$('.journey-node-row').forEach(row => {
    row.addEventListener('click', () => openDayDetail(row.dataset.dateKey, +row.dataset.dayNum));
  });
}

async function openDayDetail(dateKey, dayNum) {
  const chapter = R66.chapterFor(dayNum);
  const completions = await R66.getCompletionsForDate(dateKey);
  const habits = await R66.listHabits();
  const doneCount = completions.filter(c => c.completed).length;
  const dueCount = habits.filter(h => R66.isHabitDueOn(h, dateKey)).length;
  const xpTx = (await R66.getXPTransactions()).filter(t => t.dateKey === dateKey);
  const xpEarned = xpTx.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0);

  openSheet(`
    <h3>Day ${dayNum} · Chapter ${chapter}</h3>
    <div class="day-detail-row"><span class="k">Habits completed</span><span class="v">${doneCount}/${dueCount}</span></div>
    <div class="day-detail-row"><span class="k">XP earned</span><span class="v">+${xpEarned}</span></div>
    <div class="sheet-actions">
      <button class="secondary-btn" id="closeDayDetail" style="flex:1;">Close</button>
    </div>
  `, (root) => {
    $('#closeDayDetail', root).addEventListener('click', closeSheet);
  });
}

// ======================================================================
// REWARDS
// ======================================================================
async function renderRewards() {
  const balance = await R66.getXPBalance();
  $('#walletChip').textContent = `◆ ${balance}`;

  const info = await R66.getTodayInfo();
  let activeInLast7 = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(info.now); d.setDate(d.getDate() - i);
    const comps = await R66.getCompletionsForDate(R66.dateKeyOf(d));
    if (comps.some(c => c.completed)) activeInLast7++;
  }
  $('#weekActivePct').textContent = `${activeInLast7}/7`;
  $('#weekActiveFill').style.width = Math.round((activeInLast7 / 7) * 100) + '%';

  const badges = await R66.listBadges();
  $('#badgesCount').textContent = `${badges.length} earned`;
  $('#badgesEmpty').classList.toggle('show', badges.length === 0);
  const badgesGrid = $('#badgesGrid');
  badgesGrid.innerHTML = '';
  badges.forEach(b => {
    const chip = document.createElement('div');
    chip.className = 'badge-chip';
    chip.innerHTML = `<div class="badge-icon">${b.icon}</div><div class="badge-name">${escapeHtml(b.name)}</div>`;
    badgesGrid.appendChild(chip);
  });

  const rewards = await R66.listRewards();
  const grid = $('#rewardGrid');
  grid.innerHTML = '';
  rewards.forEach(r => {
    const unlocked = balance >= r.cost;
    const card = document.createElement('div');
    card.className = 'reward-card ' + (unlocked ? 'unlocked' : 'locked');
    card.innerHTML = `
      ${r.custom ? `<button class="reward-del" data-del="${r.id}">✕</button>` : ''}
      <div class="reward-icon">${unlocked ? '✨' : '🔒'}</div>
      <div class="reward-name">${escapeHtml(r.name)}</div>
      <div class="reward-cost">◆ ${r.cost}${r.lastRedeemedAt ? ' · redeemed' : ''}</div>
      <button class="reward-redeem-btn" data-redeem="${r.id}" ${unlocked ? '' : 'disabled'}>${unlocked ? 'Redeem' : `Need ${r.cost - balance} more`}</button>`;
    grid.appendChild(card);
  });

  $$('[data-redeem]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await R66.redeemReward(btn.dataset.redeem);
      const card = btn.closest('.reward-card');
      card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
      toast('Enjoy — you earned it.');
      setTimeout(renderRewards, 350);
    } catch (e) {
      toast(e.message === 'INSUFFICIENT_BALANCE' ? 'Not quite enough yet.' : 'Something went wrong.');
    }
  }));
  $$('[data-del]').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this reward?')) return;
    await R66.deleteReward(btn.dataset.del);
    await renderRewards();
  }));
}

$('#addRewardBtn').addEventListener('click', () => {
  openSheet(`
    <h3>Add reward</h3>
    <div class="field-label">Reward name</div>
    <input class="text-input" id="rewardName" placeholder="e.g. Coffee treat">
    <div class="field-label">XP cost</div>
    <input class="text-input" id="rewardCost" type="number" min="1" placeholder="50">
    <div class="field-label">Description (optional)</div>
    <input class="text-input" id="rewardDesc" placeholder="What is this reward?">
    <div class="sheet-actions">
      <button class="secondary-btn" id="cancelReward">Cancel</button>
      <button class="primary-btn" id="saveReward">Add reward</button>
    </div>
  `, (root) => {
    $('#cancelReward', root).addEventListener('click', closeSheet);
    $('#saveReward', root).addEventListener('click', async () => {
      const name = $('#rewardName', root).value.trim();
      const cost = parseInt($('#rewardCost', root).value, 10);
      if (!name) { toast('Give the reward a name'); return; }
      if (!cost || cost < 1) { toast('Set an XP cost of at least 1'); return; }
      await R66.createReward({ name, cost, description: $('#rewardDesc', root).value.trim() });
      closeSheet(); await renderRewards();
    });
  });
});

$('#viewXpHistoryBtn').addEventListener('click', async () => {
  const tx = await R66.getXPTransactions();
  openSheet(`
    <h3>XP history</h3>
    ${tx.length === 0 ? '<p style="color:var(--text-secondary); font-size:13.5px;">No XP activity yet — complete a habit to get started.</p>' : tx.map(t => `
      <div class="xp-history-item">
        <span>${escapeHtml(t.reason)}</span>
        <span class="amt ${t.amount > 0 ? 'pos' : 'neg'}">${t.amount > 0 ? '+' : ''}${t.amount} XP</span>
      </div>`).join('')}
    <div class="sheet-actions"><button class="secondary-btn" id="closeXpHistory" style="flex:1;">Close</button></div>
  `, (root) => $('#closeXpHistory', root).addEventListener('click', closeSheet));
});

// ======================================================================
// BUDGET
// ======================================================================
let currentBudgetMonthKey = null;

function fmtMoney(n) {
  return '₹' + Math.round(n || 0).toLocaleString('en-IN');
}

async function getBudgetMonthKey() {
  if (!currentBudgetMonthKey) {
    currentBudgetMonthKey = R66.monthKeyOf(R66.getEffectiveNow());
  }
  return currentBudgetMonthKey;
}

function fmtDate(dateKey) {
  return new Date(dateKey + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// A signed "kept aside" row shared by the Monthly and Weekly breakdowns: nice,
// human wording instead of a bare "remaining" figure that reads like a sum.
function keptAsideRow(fromLabel, minusLabel, amountLeft) {
  if (amountLeft < 0) {
    return `<div class="budget-breakdown-row result" style="color:var(--danger);"><span>You've planned ${fmtMoney(-amountLeft)} more than you have</span></div>`;
  }
  return `<div class="budget-breakdown-row result"><span>Kept aside for later</span><span class="amt">${fmtMoney(amountLeft)}</span></div>`;
}
// (kept for now — unused since the breakdown boxes were replaced by balance-line
// sentences, but harmless to leave in case we want the boxed style again)

async function renderBudget() {
  const monthKey = await getBudgetMonthKey();
  $('#monthLabelText').textContent = R66.monthLabel(monthKey);
  const todayKey = R66.dateKeyOf(R66.getEffectiveNow());

  const budget = await R66.getBudget(monthKey);
  const spent = await R66.getTotalSpent(monthKey);
  const reserved = await R66.getReservedTotal(monthKey);
  const remaining = budget.amount - spent;
  const freeToSpend = remaining - reserved;
  const pct = budget.amount > 0 ? Math.min(100, Math.round((spent / budget.amount) * 100)) : 0;

  // ---- TOTAL tier: a running balance built from money you've logged as added ----
  const totalMoney = await R66.getTotalDeposited();
  const spentAllTime = await R66.getTotalSpentAllTime();
  const totalRemaining = totalMoney - spentAllTime;

  $('#accTotalValue').textContent = fmtMoney(totalRemaining);
  $('#totalBalanceLine').innerHTML = totalMoney === 0
    ? "Add the money you've received to start tracking."
    : spentAllTime === 0
      ? `Total money <b>${fmtMoney(totalMoney)}</b>. Nothing spent yet — all of it is still yours.`
      : `Total money <b>${fmtMoney(totalMoney)}</b>. Out of it, you've spent <b>${fmtMoney(spentAllTime)}</b>, so <b>${fmtMoney(totalRemaining)}</b> is still yours.`;

  // ---- Money added (deposit history) ----
  const deposits = await R66.listDeposits();
  const depositList = $('#depositList');
  depositList.innerHTML = '';
  $('#depositEmpty').classList.toggle('show', deposits.length === 0);
  deposits.forEach(dep => {
    const row = document.createElement('div');
    row.className = 'deposit-row';
    row.innerHTML = `
      <div class="deposit-icon">+</div>
      <div class="deposit-info">
        <div class="deposit-label">${dep.note ? escapeHtml(dep.note) : 'Money added'}</div>
        <div class="deposit-date">${fmtDate(dep.date)}</div>
      </div>
      <span class="deposit-amount">+${fmtMoney(dep.amount)}</span>
      <button class="deposit-del" data-del-deposit="${dep.id}">✕</button>`;
    depositList.appendChild(row);
  });
  $$('[data-del-deposit]', depositList).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this entry?')) return;
      await R66.deleteDeposit(btn.dataset.delDeposit);
      await renderBudget();
    });
  });

  // ---- MONTHLY tier (the always-visible hero, with a circular gauge) ----
  $('#tierMonthlyAmount').textContent = `Planned: ${fmtMoney(budget.amount)}`;
  $('#gaugeSpent').textContent = fmtMoney(spent);
  $('#gaugeLeft').textContent = fmtMoney(Math.max(0, remaining));
  $('#donutPct').textContent = `${pct}%`;
  const gaugeColor = remaining < 0 ? '#F08A8A' : '#A78BFA';
  const gaugeDeg = Math.min(360, pct * 3.6);
  $('#monthlyGauge').style.background = budget.amount === 0
    ? 'conic-gradient(rgba(255,255,255,0.1) 0deg 360deg)'
    : `conic-gradient(${gaugeColor} 0deg ${gaugeDeg}deg, rgba(255,255,255,0.1) ${gaugeDeg}deg 360deg)`;

  $('#monthlyBalanceLine').innerHTML = budget.amount === 0
    ? 'Set a monthly budget to get started.'
    : remaining < 0
      ? `You've gone <b>${fmtMoney(-remaining)}</b> over your <b>${fmtMoney(budget.amount)}</b> budget this month.`
      : `Planned <b>${fmtMoney(budget.amount)}</b> for ${R66.monthLabel(monthKey)}. Spent <b>${fmtMoney(spent)}</b>, so <b>${fmtMoney(remaining)}</b> is left.`;

  // ---- WEEKLY tier (current real-world week, recurring target) ----
  const weeklyBudget = await R66.getWeeklyBudget();
  const now = R66.getEffectiveNow();
  const weekRange = R66.getWeekRange(now);
  const spentThisWeek = await R66.getSpentInRange(weekRange.start, weekRange.end);
  const weekRemaining = weeklyBudget.amount - spentThisWeek;
  const weekPct = weeklyBudget.amount > 0 ? Math.min(100, Math.round((spentThisWeek / weeklyBudget.amount) * 100)) : 0;
  const weekFmt = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  $('#accWeeklyValue').textContent = fmtMoney(Math.max(0, weekRemaining));
  $('#tierWeeklyAmount').textContent = `Target: ${fmtMoney(weeklyBudget.amount)}`;
  $('#weekRangeText').textContent = `${weekFmt(weekRange.start)} – ${weekFmt(weekRange.end)}`;
  $('#weekSpentLabel').textContent = `${fmtMoney(spentThisWeek)} spent`;
  $('#weekSpentPct').textContent = `${weekPct}%`;
  $('#weekSpentFill').style.width = weekPct + '%';
  $('#weekSpentFill').style.background = weekRemaining < 0
    ? 'linear-gradient(90deg, #E8807E, #F08A8A)'
    : 'linear-gradient(90deg, #9C8CE0, #E79FB0)';
  $('#weekCaption').textContent = weeklyBudget.amount === 0
    ? 'Set a weekly target to start tracking.'
    : weekRemaining < 0
      ? `You've gone ${fmtMoney(-weekRemaining)} over this week's target.`
      : `${fmtMoney(weekRemaining)} left of ${fmtMoney(weeklyBudget.amount)} this week.`;
  $('#weeklyBalanceLine').innerHTML = weeklyBudget.amount === 0
    ? ''
    : `Target <b>${fmtMoney(weeklyBudget.amount)}</b> for the week. Spent <b>${fmtMoney(spentThisWeek)}</b>, so <b>${fmtMoney(Math.max(0, weekRemaining))}</b> is left.`;

  // ---- the bold headline statement (based on the monthly tier) ----
  const noteCard = $('#budgetNoteCard');
  const plannedItems = await R66.listPlannedItems(monthKey);
  const unpurchased = plannedItems.filter(i => !i.purchased);
  if (budget.amount === 0) {
    noteCard.style.display = 'none';
  } else {
    noteCard.style.display = '';
    let tone = 'tone-ok', title = 'Looking good';
    if (freeToSpend < 0) { tone = 'tone-over'; title = 'Over budget'; }
    else if (freeToSpend < budget.amount * 0.2) { tone = 'tone-warn'; title = 'Spend carefully'; }

    let body;
    if (unpurchased.length === 0) {
      body = freeToSpend < 0
        ? `You've gone <b>${fmtMoney(-freeToSpend)}</b> over your budget for ${R66.monthLabel(monthKey)}.`
        : `You can still spend <b>${fmtMoney(freeToSpend)}</b> for the rest of ${R66.monthLabel(monthKey)}.`;
    } else {
      const itemsLine = unpurchased.map(i => `${escapeHtml(i.label)} (${fmtMoney(i.amount)})`).join(', ');
      if (freeToSpend < 0) {
        body = `Once you cover ${itemsLine}, you're <b>${fmtMoney(-freeToSpend)}</b> over what's left. Try to hold off on anything else.`;
      } else {
        body = `After ${itemsLine}, you can still spend <b>${fmtMoney(freeToSpend)}</b> for the rest of the month.`;
      }
    }
    noteCard.className = `headline-note ${tone}`;
    noteCard.innerHTML = `<div class="note-title">${title}</div><div class="note-body">${body}</div>`;
  }

  // ---- planned purchases list ----
  const plannedList = $('#plannedList');
  plannedList.innerHTML = '';
  $('#plannedEmpty').classList.toggle('show', plannedItems.length === 0);
  plannedItems.forEach(item => {
    const row = document.createElement('div');
    row.className = 'planned-row' + (item.purchased ? ' purchased' : '');
    row.innerHTML = `
      <div class="planned-check ${item.purchased ? 'done' : ''}" data-toggle-planned="${item.id}">
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 12.5L9.5 18L20 6" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="planned-info">
        <div class="planned-label ${item.purchased ? 'done' : ''}">${escapeHtml(item.label)}</div>
        <div class="planned-date">${fmtDate(item.date)}${item.note ? ' · ' + escapeHtml(item.note) : ''}</div>
      </div>
      <span class="planned-amount">${fmtMoney(item.amount)}</span>
      <button class="planned-del" data-del-planned="${item.id}">✕</button>`;
    plannedList.appendChild(row);
  });
  $$('[data-toggle-planned]', plannedList).forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = plannedItems.find(i => i.id === btn.dataset.togglePlanned);
      await R66.updatePlannedItem(item.id, { purchased: !item.purchased });
      await renderBudget();
    });
  });
  $$('[data-del-planned]', plannedList).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this planned purchase?')) return;
      await R66.deletePlannedItem(btn.dataset.delPlanned);
      await renderBudget();
    });
  });

  // ---- expense log ----
  const expenses = await R66.listExpenses(monthKey);
  $('#accExpenseCount').textContent = expenses.length;
  const expenseList = $('#expenseList');
  expenseList.innerHTML = '';
  $('#expenseEmpty').classList.toggle('show', expenses.length === 0);
  expenses.forEach(exp => {
    const row = document.createElement('div');
    row.className = 'expense-row';
    row.innerHTML = `
      <div class="expense-icon">${(exp.label[0] || '?').toUpperCase()}</div>
      <div class="expense-info">
        <div class="expense-label">${escapeHtml(exp.label)}</div>
        <div class="expense-date">${fmtDate(exp.date)}</div>
        ${exp.note ? `<div class="expense-note">${escapeHtml(exp.note)}</div>` : ''}
      </div>
      <span class="expense-amount">-${fmtMoney(exp.amount)}</span>
      <button class="expense-del" data-del-expense="${exp.id}">✕</button>`;
    expenseList.appendChild(row);
  });
  $$('[data-del-expense]', expenseList).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this expense?')) return;
      await R66.deleteExpense(btn.dataset.delExpense);
      await renderBudget();
    });
  });
}

$('#monthPrevBtn').addEventListener('click', async () => {
  const key = await getBudgetMonthKey();
  currentBudgetMonthKey = R66.shiftMonthKey(key, -1);
  await renderBudget();
});
$('#monthNextBtn').addEventListener('click', async () => {
  const key = await getBudgetMonthKey();
  currentBudgetMonthKey = R66.shiftMonthKey(key, 1);
  await renderBudget();
});

$('#addMoneyBtn').addEventListener('click', async () => {
  const todayKey = R66.dateKeyOf(R66.getEffectiveNow());
  openSheet(`
    <h3>Add money</h3>
    <div class="field-label">How much did you get?</div>
    <input class="text-input" id="depositAmountInput" type="number" inputmode="decimal" placeholder="e.g. 4000">
    <div class="field-label">Date</div>
    <input class="text-input" id="depositDateInput" type="date" value="${todayKey}">
    <div class="field-label">Note (optional)</div>
    <input class="text-input" id="depositNoteInput" placeholder="e.g. Pocket money from Dad">
    <div class="sheet-actions">
      <button class="secondary-btn" id="cancelDepositBtn">Cancel</button>
      <button class="primary-btn" id="saveDepositBtn">Add</button>
    </div>
  `, (root) => {
    $('#cancelDepositBtn', root).addEventListener('click', closeSheet);
    $('#saveDepositBtn', root).addEventListener('click', async () => {
      const amount = parseFloat($('#depositAmountInput', root).value) || 0;
      if (amount <= 0) { toast('Enter an amount'); return; }
      const date = $('#depositDateInput', root).value || todayKey;
      const note = $('#depositNoteInput', root).value.trim();
      await R66.addDeposit({ amount, date, note });
      closeSheet(); await renderBudget();
    });
  });
});

$('#editBudgetCard').addEventListener('click', async () => {
  const monthKey = await getBudgetMonthKey();
  const budget = await R66.getBudget(monthKey);
  openSheet(`
    <h3>Budget for ${R66.monthLabel(monthKey)}</h3>
    <div class="field-label">Amount planned for this month</div>
    <input class="text-input" id="budgetAmountInput" type="number" inputmode="decimal" placeholder="e.g. 1200" value="${budget.amount || ''}">
    <div class="sheet-actions">
      <button class="secondary-btn" id="cancelBudgetBtn">Cancel</button>
      <button class="primary-btn" id="saveBudgetBtn">Save</button>
    </div>
  `, (root) => {
    $('#cancelBudgetBtn', root).addEventListener('click', closeSheet);
    $('#saveBudgetBtn', root).addEventListener('click', async () => {
      const val = parseFloat($('#budgetAmountInput', root).value) || 0;
      await R66.setBudget(monthKey, val);
      closeSheet(); await renderBudget();
    });
  });
});

$('#editWeeklyBudgetBtn').addEventListener('click', async () => {
  const weeklyBudget = await R66.getWeeklyBudget();
  openSheet(`
    <h3>Weekly budget</h3>
    <div class="field-label">Recurring target for each week</div>
    <input class="text-input" id="weeklyBudgetInput" type="number" inputmode="decimal" placeholder="e.g. 300" value="${weeklyBudget.amount || ''}">
    <div class="sheet-actions">
      <button class="secondary-btn" id="cancelWeeklyBudgetBtn">Cancel</button>
      <button class="primary-btn" id="saveWeeklyBudgetBtn">Save</button>
    </div>
  `, (root) => {
    $('#cancelWeeklyBudgetBtn', root).addEventListener('click', closeSheet);
    $('#saveWeeklyBudgetBtn', root).addEventListener('click', async () => {
      const val = parseFloat($('#weeklyBudgetInput', root).value) || 0;
      await R66.setWeeklyBudget(val);
      closeSheet(); await renderBudget();
    });
  });
});

$('#addPlannedBtn').addEventListener('click', async () => {
  const monthKey = await getBudgetMonthKey();
  const todayKey = R66.dateKeyOf(R66.getEffectiveNow());
  const defaultDate = monthKey === R66.monthKeyOf(R66.getEffectiveNow()) ? todayKey : `${monthKey}-01`;
  openSheet(`
    <h3>Planned purchase</h3>
    <div class="field-label">What do you need to buy?</div>
    <input class="text-input" id="plannedLabelInput" placeholder="e.g. Dentist appointment">
    <div class="field-label">Estimated cost</div>
    <input class="text-input" id="plannedAmountInput" type="number" inputmode="decimal" placeholder="e.g. 500">
    <div class="field-label">When</div>
    <input class="text-input" id="plannedDateInput" type="date" value="${defaultDate}">
    <div class="field-label">Note (optional)</div>
    <input class="text-input" id="plannedNoteInput" placeholder="e.g. might range 400–500">
    <div class="sheet-actions">
      <button class="secondary-btn" id="cancelPlannedBtn">Cancel</button>
      <button class="primary-btn" id="savePlannedBtn">Add</button>
    </div>
  `, (root) => {
    $('#cancelPlannedBtn', root).addEventListener('click', closeSheet);
    $('#savePlannedBtn', root).addEventListener('click', async () => {
      const label = $('#plannedLabelInput', root).value.trim();
      const amount = parseFloat($('#plannedAmountInput', root).value) || 0;
      const date = $('#plannedDateInput', root).value || defaultDate;
      const note = $('#plannedNoteInput', root).value.trim();
      if (!label) { toast('Give it a name'); return; }
      await R66.addPlannedItem({ label, amount, note, date });
      const newMonthKey = R66.monthKeyOf(new Date(date + 'T00:00:00'));
      closeSheet(); await renderBudget();
      if (newMonthKey !== monthKey) toast(`Added to ${R66.monthLabel(newMonthKey)} — you're still viewing ${R66.monthLabel(monthKey)}`);
    });
  });
});

$('#addExpenseBtn').addEventListener('click', async () => {
  const monthKey = await getBudgetMonthKey();
  const todayKey = R66.dateKeyOf(R66.getEffectiveNow());
  const defaultDate = monthKey === R66.monthKeyOf(R66.getEffectiveNow()) ? todayKey : `${monthKey}-01`;
  openSheet(`
    <h3>Log an expense</h3>
    <div class="field-label">What did you spend on?</div>
    <input class="text-input" id="expenseLabelInput" placeholder="e.g. Groceries">
    <div class="field-label">Amount</div>
    <input class="text-input" id="expenseAmountInput" type="number" inputmode="decimal" placeholder="e.g. 350">
    <div class="field-label">Date</div>
    <input class="text-input" id="expenseDateInput" type="date" value="${defaultDate}">
    <div class="field-label">Note (optional)</div>
    <input class="text-input" id="expenseNoteInput" placeholder="e.g. Weekly groceries with roommate">
    <div class="sheet-actions">
      <button class="secondary-btn" id="cancelExpenseBtn">Cancel</button>
      <button class="primary-btn" id="saveExpenseBtn">Add</button>
    </div>
  `, (root) => {
    $('#cancelExpenseBtn', root).addEventListener('click', closeSheet);
    $('#saveExpenseBtn', root).addEventListener('click', async () => {
      const label = $('#expenseLabelInput', root).value.trim();
      const amount = parseFloat($('#expenseAmountInput', root).value) || 0;
      const date = $('#expenseDateInput', root).value || defaultDate;
      const note = $('#expenseNoteInput', root).value.trim();
      if (!label) { toast('Give it a name'); return; }
      if (amount <= 0) { toast('Enter an amount'); return; }
      await R66.addExpense({ label, amount, date, note });
      const newMonthKey = R66.monthKeyOf(new Date(date + 'T00:00:00'));
      closeSheet(); await renderBudget();
      if (newMonthKey !== monthKey) toast(`Logged under ${R66.monthLabel(newMonthKey)} — you're still viewing ${R66.monthLabel(monthKey)}`);
    });
  });
});


// ======================================================================
// STATS
// ======================================================================
function animateNumber(el, target, formatter) {
  const t0 = performance.now(); const dur = 700;
  function tick(t) {
    const p = Math.min(1, (t - t0) / dur); const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = formatter ? formatter(Math.round(eased * target)) : Math.round(eased * target);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function renderStats() {
  const info = await R66.getTodayInfo();
  const balance = await R66.getXPBalance();
  const levelInfo = R66.levelForXP(balance);
  const streaks = await R66.computeStreaks();
  const habits = await R66.listHabits();
  const cats = await R66.listCategories();
  const user = await R66.getUser();

  animateNumber($('#statLevel'), levelInfo.level);
  $('#statXP').textContent = `${balance} XP`;
  animateNumber($('#statStreak'), streaks.current);
  $('#statLongest').textContent = `Longest: ${streaks.longest} days`;
  animateNumber($('#statTotalDays'), streaks.totalCompletedDays);
  $('#statChapter').textContent = `Chapter ${info.chapter} · Day ${info.dayInChapter}`;

  const allCompletions = await R66.Store.getAll('completions');
  const doneTotal = allCompletions.filter(c => c.completed).length;
  let dueTotal = 0;
  for (let d = 1; d <= info.dayNumber; d++) {
    const dayDate = new Date(user.challengeStartDate); dayDate.setDate(dayDate.getDate() + (d - 1));
    const dk = R66.dateKeyOf(dayDate);
    dueTotal += habits.filter(h => R66.isHabitDueOn(h, dk)).length;
  }
  const completionRate = dueTotal ? Math.round((doneTotal / dueTotal) * 100) : 0;
  animateNumber($('#statCompletion'), completionRate, v => v + '%');

  const weekRow = $('#weekRow'); weekRow.innerHTML = '';
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(info.now); d.setDate(d.getDate() - i);
    const dk = R66.dateKeyOf(d);
    const comps = await R66.getCompletionsForDate(dk);
    const done = comps.filter(c => c.completed).length;
    const isToday = dk === info.dateKey;
    const col = document.createElement('div'); col.className = 'week-day' + (isToday ? ' is-today' : '');
    const nodeColor = isToday ? 'linear-gradient(135deg,#A78BFA,#F0A0C0)' : done > 0 ? 'rgba(167,139,250,0.55)' : 'rgba(255,255,255,0.08)';
    col.innerHTML = `<div class="wd-label">${dayLabels[d.getDay()]}</div><div class="week-node" style="background:${nodeColor}"></div><div class="wd-daynum">${d.getDate()}</div>`;
    weekRow.appendChild(col);
  }

  $('#heatmapMonthLabel').textContent = info.now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const heat = $('#heatmap'); heat.innerHTML = '';
  const now = info.now;
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  for (let i = 0; i < firstOfMonth.getDay(); i++) heat.appendChild(document.createElement('div'));
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(now.getFullYear(), now.getMonth(), day);
    const dk = R66.dateKeyOf(d);
    const comps = d <= now ? await R66.getCompletionsForDate(dk) : [];
    const done = comps.filter(c => c.completed).length;
    const isToday = dk === info.dateKey;
    const cell = document.createElement('div');
    cell.className = 'heat-cell' + (done > 0 ? ' has-activity' : '') + (isToday ? ' is-today' : '');
    cell.innerHTML = `<span class="heat-daynum">${day}</span>`;
    if (d <= now) {
      const intensity = Math.min(1, done / 4);
      cell.style.background = done > 0 ? `rgba(167,139,250,${0.2 + intensity * 0.55})` : 'rgba(255,255,255,0.06)';
    }
    heat.appendChild(cell);
  }
  requestAnimationFrame(() => $$('.heat-cell', heat).forEach(c => c.style.opacity = 1));

  const perf = $('#catPerf'); perf.innerHTML = '';
  for (const cat of cats) {
    const catHabits = habits.filter(h => h.categoryId === cat.id);
    if (catHabits.length === 0) continue;
    let due = 0, done = 0;
    for (let d = 1; d <= info.dayNumber; d++) {
      const dayDate = new Date(user.challengeStartDate); dayDate.setDate(dayDate.getDate() + (d - 1));
      const dk = R66.dateKeyOf(dayDate);
      for (const h of catHabits) {
        if (R66.isHabitDueOn(h, dk)) {
          due++;
          if (await R66.isHabitDone(h.id, dk)) done++;
        }
      }
    }
    const pct = due ? Math.round((done / due) * 100) : 0;
    const row = document.createElement('div'); row.className = 'cat-perf-row';
    row.innerHTML = `<div class="cat-perf-label">${escapeHtml(cat.name)}</div><div class="cat-perf-track"><div class="cat-perf-fill" data-pct="${pct}" style="background:${categoryColor(cat.colorKey)}"></div></div><div class="cat-perf-pct">${pct}%</div>`;
    perf.appendChild(row);
  }
  requestAnimationFrame(() => $$('.cat-perf-fill', perf).forEach(f => f.style.width = f.dataset.pct + '%'));
}

// ======================================================================
// SETTINGS
// ======================================================================
async function renderSettingsList() {
  const settings = await R66.getSettings();
  const list = $('#settingsList');
  list.innerHTML = `
    <div class="settings-row" data-detail="account"><div><div class="label">Account</div><div class="sub">Google profile, sign-in</div></div><span class="chev">›</span></div>
    <div class="settings-row" data-detail="notifications"><div><div class="label">Notifications</div><div class="sub">Daily reminder</div></div><span class="chev">›</span></div>
    <div class="settings-row" data-detail="backup"><div><div class="label">Backup</div><div class="sub">${settings.driveConnected ? 'Connected ✓' : 'Not connected'}</div></div><span class="chev">›</span></div>
    <div class="settings-row" data-detail="storage"><div><div class="label">Storage</div><div class="sub">Manage local data</div></div><span class="chev">›</span></div>
    <div class="settings-row" data-detail="data"><div><div class="label">Data</div><div class="sub">Export or delete</div></div><span class="chev">›</span></div>
    <div class="settings-row" data-detail="privacy"><div><div class="label">Privacy</div><div class="sub">Budget & data privacy</div></div><span class="chev">›</span></div>
    <div class="settings-row" data-detail="appearance"><div><div class="label">Appearance</div><div class="sub">Night mode</div></div><span class="chev">›</span></div>
    <div class="settings-row" data-detail="about"><div><div class="label">About</div><div class="sub">Evolve</div></div><span class="chev">›</span></div>
    <div class="settings-row" data-detail="devtools"><div><div class="label">Developer / QA tools</div><div class="sub">Test Day 66 → 67, jump dates</div></div><span class="chev">›</span></div>
  `;
  $$('.settings-row', list).forEach(row => row.addEventListener('click', () => openSettingsDetail(row.dataset.detail)));
}

async function openSettingsDetail(key) {
  showScreen('settings-detail');
  const body = $('#settingsDetailBody');
  const settings = await R66.getSettings();

  if (key === 'account') {
    body.innerHTML = `
      <div class="notice-card info">Google sign-in isn't configured in this build. When it is, your profile will show here — sign-in alone will not grant Drive access (that's a separate step under Backup).</div>
      <button class="primary-btn" disabled>Sign in with Google</button>`;
  } else if (key === 'notifications') {
    body.innerHTML = `
      <div class="field-label">Daily reminder</div>
      <input class="text-input" type="time" id="reminderTimeInput" value="${settings.reminderTime || ''}">
      <div class="notice-card info" style="margin-top:12px;">Actual push notifications require a service-worker notification permission flow, which is scaffolded but not wired to a backend in this build.</div>
      <button class="primary-btn" id="saveReminder" style="margin-top:10px;">Save</button>`;
    $('#saveReminder').addEventListener('click', async () => { await R66.updateSettings({ reminderTime: $('#reminderTimeInput').value }); toast('Saved'); });
  } else if (key === 'backup') {
    body.innerHTML = `<div class="notice-card info">Checking connection...</div>`;
    const driveStatus = await checkDriveStatus();
    if (driveStatus.reachable && driveStatus.connected) {
      body.innerHTML = `
        <div class="settings-row"><div><div class="label">Google Drive</div><div class="sub">Connected ✓</div></div></div>
        <div class="settings-row"><div><div class="label">Evolve Backup</div><div class="sub">Last backup: ${driveStatus.lastBackup ? new Date(driveStatus.lastBackup).toLocaleString() : 'Never'}</div></div></div>
        <div style="display:flex; gap:10px; margin-top:14px;">
          <button class="secondary-btn" id="backupNow">Back up now</button>
          <button class="secondary-btn" id="disconnectDrive">Disconnect</button>
        </div>
        <div class="notice-card info" style="margin-top:14px;">This backs up your habits, budget, XP and rewards history as structured data.</div>`;
      $('#backupNow').addEventListener('click', async () => {
        $('#backupNow').textContent = 'Backing up...'; $('#backupNow').disabled = true;
        const result = await performDriveBackup();
        if (result.ok) { await R66.updateSettings({ driveConnected: true, driveLastBackup: result.lastBackup }); toast('Backed up'); }
        else toast("Couldn't back up right now — try again.");
        openSettingsDetail('backup');
      });
      $('#disconnectDrive').addEventListener('click', async () => {
        await fetch('/.netlify/functions/drive-disconnect', { method: 'POST' }).catch(() => {});
        await R66.updateSettings({ driveConnected: false });
        openSettingsDetail('backup');
      });
    } else if (driveStatus.reachable && !driveStatus.connected) {
      body.innerHTML = `
        <div class="notice-card info">Connect your Google account to back up your budget, habits and stats to a private "Evolve Backup" folder in your own Drive. Evolve only ever sees files it creates there — nothing else in your Drive.</div>
        <button class="primary-btn" id="connectDriveBtn">Connect Google Drive</button>`;
      $('#connectDriveBtn').addEventListener('click', () => { window.location.href = '/.netlify/functions/auth-start'; });
    } else {
      body.innerHTML = `
        <div class="notice-card info">Google Drive backup isn't reachable from this deployment yet — the serverless functions either aren't deployed or aren't configured. This screen is the finished UI for that flow; it will not fake a connection. See the project README for the exact deploy steps.</div>
        <button class="primary-btn" disabled>Connect Google Drive</button>`;
    }
  } else if (key === 'storage') {
    const expenses = await R66.Store.getAll('expenses');
    const plannedItems = await R66.Store.getAll('plannedItems');
    const budgets = await R66.Store.getAll('budgets');
    const deposits = await R66.Store.getAll('deposits');
    body.innerHTML = `
      <div class="storage-row"><span>Money added</span><span>${deposits.length} entries</span></div>
      <div class="storage-row"><span>Budgets set</span><span>${budgets.length} months</span></div>
      <div class="storage-row"><span>Expenses logged</span><span>${expenses.length} items</span></div>
      <div class="storage-row"><span>Planned purchases</span><span>${plannedItems.length} items</span></div>
      <div class="notice-card ${settings.persistentStorageGranted ? 'info' : 'warn'}" style="margin-top:14px;">${settings.persistentStorageGranted ? 'Persistent storage is granted — the browser will not silently clear your data under disk pressure.' : "This browser hasn't granted persistent storage. Your data is still saved locally, but in rare cases (very low disk space, long inactivity) the browser could clear it. Installing Evolve to your Home Screen makes this much less likely."}</div>
      <div class="notice-card info" style="margin-top:10px;">Everything is currently local-only (no cloud backup connected), so "remove local copy" isn't offered — that would delete your only copy. Connect Backup first to unlock it.</div>`;
  } else if (key === 'data') {
    body.innerHTML = `
      <button class="primary-btn" id="exportBtn">Export my data</button>
      <div style="height:14px;"></div>
      <button class="secondary-btn" id="deleteAllBtn" style="color:var(--danger); border-color:rgba(240,138,138,0.4);">Delete everything on this device</button>`;
    $('#exportBtn').addEventListener('click', async () => {
      const data = await R66.exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'evolve-export.json'; a.click();
      toast('Your export is ready.');
    });
    $('#deleteAllBtn').addEventListener('click', async () => {
      if (!confirm("This removes everything on this device. This can't be undone.")) return;
      indexedDB.deleteDatabase('reset66_db');
      toast('Deleted. Reloading...');
      setTimeout(() => location.reload(), 900);
    });
  } else if (key === 'privacy') {
    body.innerHTML = `<div class="notice-card info">Your budget, habits and stats stay on this device unless you explicitly connect Google Drive backup. Nothing is sent anywhere automatically.</div>`;
  } else if (key === 'appearance') {
    body.innerHTML = `<div class="notice-card info">Evolve now runs in this night theme by default. A light theme isn't built in this pass — tell me if you'd like one added as a toggle.</div>`;
  } else if (key === 'about') {
    body.innerHTML = `<div class="notice-card info">Evolve — a continuous personal growth companion. Chapters are milestones, not endings.</div>`;
  } else if (key === 'devtools') {
    const info = await R66.getTodayInfo();
    body.innerHTML = `
      <div class="notice-card warn">These tools exist only to let you test the Day 66 → Chapter 2 transition without waiting 66 real days. They shift a local clock offset — nothing about the underlying date math is special-cased.</div>
      <div class="day-detail-row"><span class="k">Current day number</span><span class="v">${info.dayNumber}</span></div>
      <div class="day-detail-row"><span class="k">Chapter</span><span class="v">${info.chapter}</span></div>
      <div class="day-detail-row"><span class="k">Clock offset</span><span class="v">${R66.getDevOffsetDays()} days</span></div>
      <div class="dev-tools">
        <h4>Jump forward</h4>
        <div class="row">
          <button class="secondary-btn" id="jumpMinus1">-1 day</button>
          <button class="secondary-btn" id="jumpPlus1">+1 day</button>
          <button class="secondary-btn" id="jumpTo66">Jump to Day 66</button>
          <button class="secondary-btn" id="jumpTo67">Jump to Day 67</button>
          <button class="secondary-btn" id="jumpReset">Reset to real date</button>
        </div>
      </div>`;
    $('#jumpMinus1').addEventListener('click', () => devJump(R66.getDevOffsetDays() - 1));
    $('#jumpPlus1').addEventListener('click', () => devJump(R66.getDevOffsetDays() + 1));
    $('#jumpTo66').addEventListener('click', () => devJump(65));
    $('#jumpTo67').addEventListener('click', () => devJump(66));
    $('#jumpReset').addEventListener('click', () => devJump(0));
  }
}

async function devJump(offsetDays) {
  R66.setDevOffsetDays(offsetDays);
  await openSettingsDetail('devtools');
  await renderToday();
}

// ======================================================================
// GOOGLE DRIVE (calls the real Netlify functions; gracefully treats a
// missing/unreachable backend as "not configured on this deploy" rather
// than throwing or faking a connection)
// ======================================================================
async function checkDriveStatus() {
  try {
    const res = await fetch('/.netlify/functions/drive-status');
    if (!res.ok) return { reachable: false, connected: false, lastBackup: null };
    const data = await res.json();
    return { reachable: true, connected: !!data.connected, lastBackup: data.lastBackup };
  } catch (e) {
    return { reachable: false, connected: false, lastBackup: null };
  }
}

async function performDriveBackup() {
  try {
    const data = await R66.exportAllData();
    const res = await fetch('/.netlify/functions/drive-backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const result = await res.json();
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function handleDriveRedirectParams() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('drive')) return;
  if (params.get('drive') === 'connected') {
    R66.updateSettings({ driveConnected: true });
    toast('Google Drive connected.');
  } else if (params.get('drive') === 'error') {
    toast("Couldn't connect Google Drive — " + (params.get('reason') || 'unknown error'));
  }
  // clean the URL so a refresh doesn't re-trigger the toast
  window.history.replaceState({}, '', window.location.pathname);
}

// ======================================================================
// OFFLINE
// ======================================================================
function updateOfflineBanner() {
  $('#offlineBanner').classList.toggle('show', !navigator.onLine);
}
window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);

// ======================================================================
// INIT
// ======================================================================
async function init() {
  await R66.getUser();
  await R66.ensureDefaultCategories();
  await R66.ensureDefaultRewards();
  updateOfflineBanner();
  await requestPersistentStorage();
  handleDriveRedirectParams();
  await renderToday();
  moveIndicator($('.nav-tab.active'));

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline-first still works via IndexedDB even if SW registration fails */ });
  }
}

async function requestPersistentStorage() {
  // Without this, browsers (Safari especially) can silently evict IndexedDB
  // data under disk pressure or after a period of inactivity. This asks the
  // browser to exempt this origin's storage from that eviction. It's a
  // permission-style request, not a guarantee -- some browsers grant it
  // silently, some prompt, some never grant it for non-installed sites.
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (!already) {
        const granted = await navigator.storage.persist();
        await R66.updateSettings({ persistentStorageGranted: granted });
      } else {
        await R66.updateSettings({ persistentStorageGranted: true });
      }
    }
  } catch (e) { /* feature not available on this browser -- nothing to fall back to, storage just stays evictable */ }
}
document.addEventListener('DOMContentLoaded', init);
window.addEventListener('resize', () => moveIndicator($('.nav-tab.active')));
})();
