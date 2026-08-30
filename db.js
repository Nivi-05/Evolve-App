// Evolve — Data layer + core logic
// Plain IndexedDB (no external deps) so this runs as static files with zero build step.

const DB_NAME = 'reset66_db';
const DB_VERSION = 5;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('habits')) {
        const s = db.createObjectStore('habits', { keyPath: 'id' });
        s.createIndex('categoryId', 'categoryId');
      }
      if (!db.objectStoreNames.contains('completions')) {
        const s = db.createObjectStore('completions', { keyPath: 'id' });
        s.createIndex('dateKey', 'dateKey');
        s.createIndex('habitId', 'habitId');
      }
      if (!db.objectStoreNames.contains('dayRecords')) db.createObjectStore('dayRecords', { keyPath: 'dateKey' });
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('dateKey', 'dateKey');
      }
      if (!db.objectStoreNames.contains('audio')) {
        const s = db.createObjectStore('audio', { keyPath: 'id' });
        s.createIndex('dateKey', 'dateKey');
      }
      if (!db.objectStoreNames.contains('transcripts')) db.createObjectStore('transcripts', { keyPath: 'audioId' });
      if (!db.objectStoreNames.contains('aiSummaries')) db.createObjectStore('aiSummaries', { keyPath: 'dateKey' });
      if (!db.objectStoreNames.contains('rewards')) db.createObjectStore('rewards', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('xpTransactions')) {
        const s = db.createObjectStore('xpTransactions', { keyPath: 'id' });
        s.createIndex('dateKey', 'dateKey');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('budgets')) db.createObjectStore('budgets', { keyPath: 'monthKey' });
      if (!db.objectStoreNames.contains('expenses')) {
        const s = db.createObjectStore('expenses', { keyPath: 'id' });
        s.createIndex('monthKey', 'monthKey');
      }
      if (!db.objectStoreNames.contains('plannedItems')) {
        const s = db.createObjectStore('plannedItems', { keyPath: 'id' });
        s.createIndex('monthKey', 'monthKey');
      }
      if (!db.objectStoreNames.contains('deposits')) {
        db.createObjectStore('deposits', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('weeklyLogs')) {
        const s = db.createObjectStore('weeklyLogs', { keyPath: 'id' });
        s.createIndex('habitId', 'habitId');
      }
      if (!db.objectStoreNames.contains('badges')) {
        db.createObjectStore('badges', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeNames, mode = 'readonly') {
  return openDB().then(db => db.transaction(storeNames, mode));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const Store = {
  async get(name, key) {
    const t = await tx([name]);
    return reqToPromise(t.objectStore(name).get(key));
  },
  async getAll(name) {
    const t = await tx([name]);
    return reqToPromise(t.objectStore(name).getAll());
  },
  async getAllByIndex(name, indexName, value) {
    const t = await tx([name]);
    return reqToPromise(t.objectStore(name).index(indexName).getAll(value));
  },
  async put(name, value) {
    const t = await tx([name], 'readwrite');
    t.objectStore(name).put(value);
    return new Promise((resolve, reject) => { t.oncomplete = () => resolve(value); t.onerror = () => reject(t.error); });
  },
  async delete(name, key) {
    const t = await tx([name], 'readwrite');
    t.objectStore(name).delete(key);
    return new Promise((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); });
  },
};

// ---------------- ID generation ----------------
function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------- Date / day-number / chapter math ----------------
// CRITICAL RULE: the current day number is always DERIVED from challengeStartDate.
// There is no stored "day counter" anywhere. Day 66 -> Day 67 happens automatically
// the moment the derived day number crosses 66; nothing is reset.

const CHAPTER_LENGTH = 66;

function toDateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dateKeyOf(d) {
  const dd = toDateOnly(d);
  const y = dd.getFullYear();
  const m = String(dd.getMonth() + 1).padStart(2, '0');
  const day = String(dd.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(a, b) {
  const MS = 86400000;
  return Math.round((toDateOnly(b) - toDateOnly(a)) / MS);
}

// A small dev-only clock offset lets QA fast-forward to test the Day 66 -> Day 67
// transition without waiting 66 real days. In a shipped build this stays at 0.
let __devOffsetDays = 0;

function getEffectiveNow() {
  const now = new Date();
  now.setDate(now.getDate() + __devOffsetDays);
  return now;
}

function setDevOffsetDays(n) { __devOffsetDays = n; }
function getDevOffsetDays() { return __devOffsetDays; }

function dayNumberFor(startDate, when) {
  return Math.max(1, daysBetween(new Date(startDate), when) + 1);
}

function chapterFor(dayNumber) {
  return Math.floor((dayNumber - 1) / CHAPTER_LENGTH) + 1;
}

function dayInChapter(dayNumber) {
  const rem = (dayNumber - 1) % CHAPTER_LENGTH;
  return rem + 1;
}

function isMilestoneDay(dayNumber) {
  return dayNumber % CHAPTER_LENGTH === 0;
}

// ---------------- Meta / user ----------------
async function getUser() {
  let user = await Store.get('meta', 'user');
  if (!user) {
    const startDate = dateKeyOf(new Date());
    user = { key: 'user', challengeStartDate: startDate, chapter1CelebrationShown: false, name: '' };
    await Store.put('meta', user);
  }
  return user;
}

async function updateUser(patch) {
  const user = await getUser();
  const next = { ...user, ...patch };
  await Store.put('meta', next);
  return next;
}

async function getTodayInfo() {
  const user = await getUser();
  const now = getEffectiveNow();
  const dayNumber = dayNumberFor(user.challengeStartDate, now);
  const chapter = chapterFor(dayNumber);
  const dayInChap = dayInChapter(dayNumber);
  return { dateKey: dateKeyOf(now), dayNumber, chapter, dayInChapter: dayInChap, now };
}

// ---------------- Categories ----------------
const DEFAULT_CATEGORY_ICONS = {
  mind: 'M', study: 'S', body: 'B', health: 'H', career: 'C',
  finance: 'F', social: 'So', personal: 'P', growth: 'G',
};

async function listCategories() {
  const cats = await Store.getAll('categories');
  return cats.sort((a, b) => a.createdAt - b.createdAt);
}

async function createCategory(name, colorKey) {
  const cat = {
    id: uid('cat'), name, colorKey: colorKey || 'mind',
    icon: (name[0] || '?').toUpperCase(), createdAt: Date.now(), active: true,
  };
  await Store.put('categories', cat);
  return cat;
}

async function ensureDefaultCategories() {
  const existing = await listCategories();
  if (existing.length > 0) return existing;
  const seeds = [
    ['Mind', 'mind'], ['Study', 'study'], ['Body', 'body'],
  ];
  const out = [];
  for (const [name, colorKey] of seeds) out.push(await createCategory(name, colorKey));
  return out;
}

// ---------------- Habits ----------------
async function listHabits() {
  return (await Store.getAll('habits')).sort((a, b) => a.createdAt - b.createdAt);
}

async function createHabit({ name, categoryId, frequency, reminderTime, xpValue }) {
  const habit = {
    id: uid('habit'), name: name.trim(), categoryId,
    frequency: frequency || { type: 'daily' },
    reminderTime: reminderTime || null,
    xpValue: (typeof xpValue === 'number' && xpValue > 0) ? Math.round(xpValue) : XP_PER_HABIT,
    active: true, createdAt: Date.now(), deletedAt: null,
  };
  await Store.put('habits', habit);
  return habit;
}

async function updateHabit(id, patch) {
  const habit = await Store.get('habits', id);
  if (!habit) return null;
  const next = { ...habit, ...patch };
  await Store.put('habits', next);
  return next;
}

async function softDeleteHabit(id) {
  return updateHabit(id, { active: false, deletedAt: Date.now() });
}

function isHabitDueOn(habit, dateKey) {
  const d = new Date(dateKey + 'T00:00:00');
  const created = dateKeyOf(new Date(habit.createdAt));
  if (dateKey < created) return false;
  if (habit.deletedAt) {
    const deletedKey = dateKeyOf(new Date(habit.deletedAt));
    if (dateKey >= deletedKey) return false;
  }
  if (habit.frequency && habit.frequency.type === 'once') {
    return dateKey === habit.frequency.date;
  }
  if (habit.frequency && habit.frequency.type === 'weekly') {
    return false; // weekly-goal habits are tracked as a running count, not a per-day checkbox
  }
  if (habit.frequency && habit.frequency.type === 'custom') {
    return habit.frequency.days.includes(d.getDay());
  }
  return true; // daily
}

// ---------------- Completions + XP ----------------
const XP_PER_HABIT = 10;

function completionId(habitId, dateKey) { return `${habitId}__${dateKey}`; }

async function getCompletionsForDate(dateKey) {
  return Store.getAllByIndex('completions', 'dateKey', dateKey);
}

async function isHabitDone(habitId, dateKey) {
  const c = await Store.get('completions', completionId(habitId, dateKey));
  return !!(c && c.completed);
}

async function toggleHabitCompletion(habitId, dateKey) {
  const habit = await Store.get('habits', habitId);
  const xpValue = (habit && typeof habit.xpValue === 'number' && habit.xpValue > 0) ? habit.xpValue : XP_PER_HABIT;
  const habitName = habit ? habit.name : 'habit';
  const id = completionId(habitId, dateKey);
  const existing = await Store.get('completions', id);
  const nowDone = !(existing && existing.completed);

  await Store.put('completions', {
    id, habitId, dateKey, completed: nowDone, completedAt: nowDone ? Date.now() : null,
  });

  // XP ledger entry mirrors completion 1:1 by shared id -> idempotent, and
  // "undo" (tapping again) simply removes the matching XP entry.
  if (nowDone) {
    await Store.put('xpTransactions', {
      id: `xp_${id}`, amount: xpValue, reason: `Completed ${habitName}`, dateKey, createdAt: Date.now(),
    });
  } else {
    await Store.delete('xpTransactions', `xp_${id}`);
  }
  return { nowDone, xpValue };
}

// ---------------- Weekly-goal habits ("talk to 4 friends this week") ----------------
// Tracked as a running count of logged instances within the current Mon–Sun
// week, rather than a single per-day checkbox.
async function logWeeklyProgress(habitId) {
  const habit = await Store.get('habits', habitId);
  const xpValue = (habit && typeof habit.xpValue === 'number' && habit.xpValue > 0) ? habit.xpValue : XP_PER_HABIT;
  const habitName = habit ? habit.name : 'habit';
  const dateKey = dateKeyOf(new Date());
  const entry = { id: uid('wlog'), habitId, dateKey, createdAt: Date.now() };
  await Store.put('weeklyLogs', entry);
  await Store.put('xpTransactions', {
    id: `xp_${entry.id}`, amount: xpValue, reason: `Progress on ${habitName}`, dateKey, createdAt: Date.now(),
  });
  return { entry, xpValue };
}

async function undoLastWeeklyLog(habitId, weekRange) {
  const all = await Store.getAllByIndex('weeklyLogs', 'habitId', habitId);
  const inWeek = all.filter(l => {
    const d = toDateOnly(new Date(l.dateKey + 'T00:00:00'));
    return d >= weekRange.start && d <= weekRange.end;
  }).sort((a, b) => b.createdAt - a.createdAt);
  if (inWeek.length === 0) return false;
  const last = inWeek[0];
  await Store.delete('weeklyLogs', last.id);
  await Store.delete('xpTransactions', `xp_${last.id}`);
  return true;
}

async function getWeeklyProgress(habitId, weekRange) {
  const all = await Store.getAllByIndex('weeklyLogs', 'habitId', habitId);
  return all.filter(l => {
    const d = toDateOnly(new Date(l.dateKey + 'T00:00:00'));
    return d >= weekRange.start && d <= weekRange.end;
  }).length;
}

// ---------------- Milestone badges ----------------
// Awards are tracked per-chapter so re-visiting an already-passed milestone
// (e.g. via the dev clock offset) never double-awards XP or badges.
async function getMilestoneAwards() {
  return (await Store.get('meta', 'milestoneAwards')) || { key: 'milestoneAwards', chapter: 1, awarded: [] };
}
async function setMilestoneAwards(chapter, awarded) {
  const next = { key: 'milestoneAwards', chapter, awarded };
  await Store.put('meta', next);
  return next;
}

async function addBadge({ chapter, milestoneIndex, name, icon, xp }) {
  const badge = { id: uid('badge'), chapter, milestoneIndex, name, icon, xp, earnedAt: Date.now() };
  await Store.put('badges', badge);
  return badge;
}
async function listBadges() {
  const all = await Store.getAll('badges');
  return all.sort((a, b) => b.earnedAt - a.earnedAt);
}

// A standalone XP grant not tied to a habit completion (e.g. milestone bonuses).
async function addXPBonus(amount, reason) {
  const tx = { id: uid('xpbonus'), amount: Math.round(amount), reason, dateKey: dateKeyOf(new Date()), createdAt: Date.now() };
  await Store.put('xpTransactions', tx);
  return tx;
}

// ---------------- XP wallet ----------------
async function getXPTransactions() {
  const all = await Store.getAll('xpTransactions');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

async function getXPBalance() {
  const all = await Store.getAll('xpTransactions');
  return all.reduce((sum, t) => sum + t.amount, 0);
}

// ---------------- Streaks / stats ----------------
async function getDatesWithAnyCompletion() {
  const all = await Store.getAll('completions');
  const dates = new Set();
  for (const c of all) if (c.completed) dates.add(c.dateKey);
  return dates;
}

async function computeStreaks() {
  const activeDates = await getDatesWithAnyCompletion();
  const { dateKey: todayKey, now } = await getTodayInfo();

  // current streak: walk backwards from today while each day has activity
  let current = 0;
  let cursor = new Date(now);
  while (true) {
    const key = dateKeyOf(cursor);
    if (activeDates.has(key)) { current++; cursor.setDate(cursor.getDate() - 1); }
    else if (key === todayKey) { cursor.setDate(cursor.getDate() - 1); } // today not done yet doesn't break streak
    else break;
  }

  // longest streak: scan all active dates sorted
  const sorted = Array.from(activeDates).sort();
  let longest = 0, run = 0, prev = null;
  for (const key of sorted) {
    if (prev) {
      const gap = daysBetween(new Date(prev), new Date(key));
      run = gap === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = key;
  }
  longest = Math.max(longest, current);

  return { current, longest, totalCompletedDays: activeDates.size };
}

// ---------------- Level ----------------
function levelForXP(xp) {
  // simple curve: level N requires N*100 cumulative XP
  let level = 1, remaining = xp;
  while (remaining >= level * 100) { remaining -= level * 100; level++; }
  return { level, xpIntoLevel: remaining, xpForNextLevel: level * 100 };
}

// ---------------- Day record (kept for backward-compat habit history) ----------------
async function getDayRecord(dateKey) {
  return (await Store.get('dayRecords', dateKey)) || { dateKey, updatedAt: null };
}

async function saveDayRecord(dateKey, patch) {
  const existing = await getDayRecord(dateKey);
  const next = { ...existing, ...patch, dateKey, updatedAt: Date.now() };
  await Store.put('dayRecords', next);
  return next;
}

// ---------------- Budget ----------------
// Budgets are tracked per calendar month ("YYYY-MM"), independent of the
// 66-day challenge clock, since spending resets on the calendar, not on Day 66.
function monthKeyOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function shiftMonthKey(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKeyOf(d);
}

async function getBudget(monthKey) {
  return (await Store.get('budgets', monthKey)) || { monthKey, amount: 0, updatedAt: null };
}

async function setBudget(monthKey, amount) {
  const next = { monthKey, amount: Math.max(0, Math.round(amount) || 0), updatedAt: Date.now() };
  await Store.put('budgets', next);
  return next;
}

// ---------------- Expenses (each dated by the person logging it, not just "now") ----------------
async function listExpenses(monthKey) {
  const all = await Store.getAllByIndex('expenses', 'monthKey', monthKey);
  return all.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : (a.date < b.date ? 1 : -1)));
}

async function addExpense({ label, amount, date, note }) {
  const spendDate = date || dateKeyOf(new Date());
  const expense = {
    id: uid('exp'), monthKey: monthKeyOf(new Date(spendDate + 'T00:00:00')),
    label: (label || '').trim() || 'Untitled expense',
    amount: Math.max(0, Math.round(amount) || 0),
    date: spendDate, note: (note || '').trim(),
    createdAt: Date.now(),
  };
  await Store.put('expenses', expense);
  return expense;
}

async function deleteExpense(id) { return Store.delete('expenses', id); }

async function getTotalSpent(monthKey) {
  const all = await listExpenses(monthKey);
  return all.reduce((s, e) => s + e.amount, 0);
}

// ---------------- Planned purchases (can be dated into a future month, so they
// only show up — and only get "reserved" — once you're actually looking at that month) ----------------
async function listPlannedItems(monthKey) {
  const all = await Store.getAllByIndex('plannedItems', 'monthKey', monthKey);
  return all.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt - b.createdAt));
}

async function addPlannedItem({ label, amount, note, date }) {
  const plannedDate = date || dateKeyOf(new Date());
  const item = {
    id: uid('plan'), monthKey: monthKeyOf(new Date(plannedDate + 'T00:00:00')),
    label: (label || '').trim() || 'Untitled item',
    amount: Math.max(0, Math.round(amount) || 0), note: note || '',
    date: plannedDate, purchased: false, createdAt: Date.now(),
  };
  await Store.put('plannedItems', item);
  return item;
}

async function updatePlannedItem(id, patch) {
  const item = await Store.get('plannedItems', id);
  if (!item) return null;
  const next = { ...item, ...patch };
  if (patch.date) next.monthKey = monthKeyOf(new Date(patch.date + 'T00:00:00'));
  await Store.put('plannedItems', next);
  return next;
}

async function deletePlannedItem(id) { return Store.delete('plannedItems', id); }

async function getReservedTotal(monthKey) {
  const items = await listPlannedItems(monthKey);
  return items.filter(i => !i.purchased).reduce((s, i) => s + i.amount, 0);
}

// ---------------- Total money: a running balance built from deposits you log ----------------
// (pocket money, allowance, etc.) rather than a single number you set once.
async function listDeposits() {
  const all = await Store.getAll('deposits');
  return all.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : (a.date < b.date ? 1 : -1)));
}

async function addDeposit({ amount, date, note }) {
  const depositDate = date || dateKeyOf(new Date());
  const deposit = {
    id: uid('dep'), amount: Math.max(0, Math.round(amount) || 0),
    date: depositDate, note: (note || '').trim(), createdAt: Date.now(),
  };
  await Store.put('deposits', deposit);
  return deposit;
}

async function deleteDeposit(id) { return Store.delete('deposits', id); }

async function getTotalDeposited() {
  const all = await Store.getAll('deposits');
  return all.reduce((s, d) => s + d.amount, 0);
}

// ---------------- Weekly budget (a recurring target, not a specific week) ----------------
async function getWeeklyBudget() {
  return (await Store.get('meta', 'weeklyBudget')) || { key: 'weeklyBudget', amount: 0, updatedAt: null };
}
async function setWeeklyBudget(amount) {
  const next = { key: 'weeklyBudget', amount: Math.max(0, Math.round(amount) || 0), updatedAt: Date.now() };
  await Store.put('meta', next);
  return next;
}

// ---------------- All-time / range spend queries (across all months) ----------------
async function getAllExpenses() {
  return Store.getAll('expenses');
}
async function getTotalSpentAllTime() {
  const all = await getAllExpenses();
  return all.reduce((s, e) => s + e.amount, 0);
}

// Monday-start week containing `date`.
function getWeekRange(date) {
  const d = toDateOnly(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d); monday.setDate(d.getDate() + diffToMonday);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return { start: monday, end: sunday };
}

async function getSpentInRange(startDate, endDate) {
  const all = await getAllExpenses();
  return all
    .filter(e => {
      const d = toDateOnly(new Date((e.date || dateKeyOf(new Date(e.createdAt))) + 'T00:00:00'));
      return d >= startDate && d <= endDate;
    })
    .reduce((s, e) => s + e.amount, 0);
}

// ---------------- Rewards ----------------
async function listRewards() {
  const all = await Store.getAll('rewards');
  return all.sort((a, b) => a.createdAt - b.createdAt);
}
async function createReward({ name, cost, description }) {
  const reward = {
    id: uid('reward'), name: name.trim(), cost: Math.max(1, Math.round(cost)),
    description: description || '', custom: true, createdAt: Date.now(), lastRedeemedAt: null,
  };
  await Store.put('rewards', reward);
  return reward;
}
async function updateReward(id, patch) {
  const r = await Store.get('rewards', id);
  if (!r) return null;
  const next = { ...r, ...patch };
  await Store.put('rewards', next);
  return next;
}
async function deleteReward(id) { return Store.delete('rewards', id); }

async function redeemReward(id) {
  const reward = await Store.get('rewards', id);
  if (!reward) throw new Error('Reward not found');
  const balance = await getXPBalance();
  if (balance < reward.cost) throw new Error('INSUFFICIENT_BALANCE');
  const { dateKey } = await getTodayInfo();
  await Store.put('xpTransactions', {
    id: uid('xp'), amount: -reward.cost, reason: `Redeemed "${reward.name}"`, dateKey, createdAt: Date.now(),
  });
  await updateReward(id, { lastRedeemedAt: Date.now() });
  return true;
}

async function ensureDefaultRewards() {
  const existing = await listRewards();
  if (existing.length > 0) return existing;
  const seeds = [
    { name: 'Coffee treat', cost: 50, description: 'A nice coffee, on you.' },
    { name: 'New playlist', cost: 30, description: 'Time to find some new music.' },
    { name: 'Movie night', cost: 120, description: 'Pick something you have been wanting to watch.' },
    { name: 'Small splurge', cost: 200, description: 'Something small just for you.' },
  ];
  const out = [];
  for (const s of seeds) out.push(await createReward(s));
  return out;
}

// ---------------- Settings ----------------
async function getSettings() {
  const s = await Store.get('settings', 'app');
  return s || {
    key: 'app', reminderTime: null,
    driveConnected: false, driveLastBackup: null,
    aiProviderConfigured: false, transcriptionProviderConfigured: false,
  };
}
async function updateSettings(patch) {
  const s = await getSettings();
  const next = { ...s, ...patch, key: 'app' };
  await Store.put('settings', next);
  return next;
}

// ---------------- Export ----------------
async function exportAllData() {
  const [categories, habits, completions, dayRecords, rewards, xpTransactions, settings, user, budgets, expenses, plannedItems, deposits, weeklyLogs, badges] = await Promise.all([
    Store.getAll('categories'), Store.getAll('habits'), Store.getAll('completions'),
    Store.getAll('dayRecords'), Store.getAll('rewards'), Store.getAll('xpTransactions'),
    getSettings(), getUser(), Store.getAll('budgets'), Store.getAll('expenses'), Store.getAll('plannedItems'), Store.getAll('deposits'), Store.getAll('weeklyLogs'), Store.getAll('badges'),
  ]);
  return { exportedAt: new Date().toISOString(), user, categories, habits, completions, dayRecords, rewards, xpTransactions, settings, budgets, expenses, plannedItems, deposits, weeklyLogs, badges };
}

// ---------------- Public API ----------------
window.R66 = {
  Store, uid, dateKeyOf, daysBetween, dayNumberFor, chapterFor, dayInChapter, isMilestoneDay,
  CHAPTER_LENGTH, setDevOffsetDays, getDevOffsetDays, getEffectiveNow,
  getUser, updateUser, getTodayInfo,
  listCategories, createCategory, ensureDefaultCategories, DEFAULT_CATEGORY_ICONS,
  listHabits, createHabit, updateHabit, softDeleteHabit, isHabitDueOn,
  getCompletionsForDate, isHabitDone, toggleHabitCompletion, XP_PER_HABIT,
  logWeeklyProgress, undoLastWeeklyLog, getWeeklyProgress,
  getMilestoneAwards, setMilestoneAwards, addBadge, listBadges, addXPBonus,
  getXPTransactions, getXPBalance, computeStreaks, levelForXP,
  getDayRecord, saveDayRecord,
  monthKeyOf, monthLabel, shiftMonthKey,
  getBudget, setBudget, listExpenses, addExpense, deleteExpense, getTotalSpent,
  listPlannedItems, addPlannedItem, updatePlannedItem, deletePlannedItem, getReservedTotal,
  listDeposits, addDeposit, deleteDeposit, getTotalDeposited,
  getWeeklyBudget, setWeeklyBudget,
  getAllExpenses, getTotalSpentAllTime, getWeekRange, getSpentInRange,
  listRewards, createReward, updateReward, deleteReward, redeemReward, ensureDefaultRewards,
  getSettings, updateSettings, exportAllData,
};
