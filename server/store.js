// JSON 文件存储：accounts / tasks / records / settings。
// 数据落盘在项目 data/ 目录，写入使用临时文件 + rename 原子替换。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');

function file(name) {
  return path.join(DATA_DIR, name);
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  ensureDir();
  const target = file(name);
  const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

// ---------- settings ----------
function loadSettings() {
  return readJson('settings.json', {});
}

function saveSettings(settings) {
  writeJson('settings.json', settings);
}

// ---------- accounts ----------
function loadAccounts() {
  return readJson('accounts.json', []);
}

function saveAccounts(accounts) {
  writeJson('accounts.json', accounts);
}

function findAccount(id) {
  return loadAccounts().find((a) => a.id === id) || null;
}

function upsertAccount(account) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) accounts[idx] = account;
  else accounts.push(account);
  saveAccounts(accounts);
  return account;
}

function deleteAccount(id) {
  const accounts = loadAccounts();
  const next = accounts.filter((a) => a.id !== id);
  if (next.length === accounts.length) return false;
  saveAccounts(next);
  return true;
}

// 账号展示信息（绝不返回 token / 密码 / 会话字段）
function accountMeta(account) {
  const {
    access_token,
    refresh_token,
    virtual_key,
    device_id,
    password,
    session_cookie,
    auth_raw,
    profile_raw,
    ...meta
  } = account;
  return meta;
}

// ---------- tasks ----------
function loadTasks() {
  return readJson('tasks.json', []);
}

function saveTasks(tasks) {
  writeJson('tasks.json', tasks);
}

function findTask(id) {
  return loadTasks().find((t) => t.id === id) || null;
}

function upsertTask(task) {
  const tasks = loadTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) tasks[idx] = task;
  else tasks.push(task);
  saveTasks(tasks);
  return task;
}

function deleteTask(id) {
  const tasks = loadTasks();
  const next = tasks.filter((t) => t.id !== id);
  if (next.length === tasks.length) return false;
  saveTasks(next);
  return true;
}

// ---------- records ----------
const MAX_RECORDS = 5000;

function loadRecords() {
  return readJson('records.json', []);
}

function saveRecords(records) {
  writeJson('records.json', records);
}

function addRecord(record) {
  const records = loadRecords();
  records.push(record);
  if (records.length > MAX_RECORDS) {
    saveRecords(records.slice(records.length - MAX_RECORDS));
  } else {
    saveRecords(records);
  }
  return record;
}

function queryRecords({ taskId, result, limit = 100 } = {}) {
  let records = loadRecords();
  if (taskId) records = records.filter((r) => r.taskId === taskId);
  if (result) records = records.filter((r) => r.result === result);
  return records.slice(-Number(limit)).reverse();
}

module.exports = {
  DATA_DIR,
  loadSettings,
  saveSettings,
  loadAccounts,
  saveAccounts,
  findAccount,
  upsertAccount,
  deleteAccount,
  accountMeta,
  loadTasks,
  saveTasks,
  findTask,
  upsertTask,
  deleteTask,
  loadRecords,
  addRecord,
  queryRecords,
};
