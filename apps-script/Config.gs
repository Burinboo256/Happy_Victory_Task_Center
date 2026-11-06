var APP_ = {
  name: 'Happy Victory Rinlyn Task Center',
  timezone: 'Asia/Bangkok',
  statuses: ['New', 'In Progress', 'Waiting', 'On Hold', 'Completed', 'Cancelled'],
  priorities: ['Low', 'Normal', 'High', 'Urgent'],
  categories: ['เอกสารกรมธรรม์', 'บริการลูกค้า', 'นัดหมาย', 'การเงิน', 'งานทั่วไป'],
  sessionSeconds: 21600
};

function config_() {
  var p = PropertiesService.getScriptProperties();
  function need(k) { var v = p.getProperty(k); if (!v) throw new Error('ยังไม่ได้ตั้งค่า ' + k + ' ใน Script Properties'); return v; }
  return {
    token: need('AIRTABLE_TOKEN'), base: need('AIRTABLE_BASE_ID'),
    tables: {
      users: p.getProperty('AIRTABLE_USERS_TABLE') || 'Users',
      tasks: p.getProperty('AIRTABLE_TASKS_TABLE') || 'Tasks',
      updates: p.getProperty('AIRTABLE_UPDATES_TABLE') || 'Task Updates',
      followups: p.getProperty('AIRTABLE_FOLLOWUPS_TABLE') || 'Follow-ups',
      notifications: p.getProperty('AIRTABLE_NOTIFICATIONS_TABLE') || 'Notifications'
    }
  };
}

function oauthConfig_() {
  var p = PropertiesService.getScriptProperties();
  var c = { clientId: p.getProperty('GOOGLE_CLIENT_ID'), secret: p.getProperty('GOOGLE_CLIENT_SECRET'), redirect: p.getProperty('WEB_APP_URL') };
  if (!c.clientId || !c.secret || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(c.redirect || '')) {
    throw new Error('กรุณาตั้งค่า GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET และ WEB_APP_URL ตามคู่มือติดตั้ง');
  }
  return c;
}

function random_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function hash_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
function today_() { return Utilities.formatDate(new Date(), APP_.timezone, 'yyyy-MM-dd'); }
function text_(v, max, required) {
  if (typeof v !== 'string' || (required && !v.trim()) || v.length > max) throw new Error('กรุณาตรวจสอบข้อความที่กรอก (สูงสุด ' + max + ' ตัวอักษร)');
  return v.trim();
}
function date_(v, required) {
  if (!v && !required) return '';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw new Error('วันที่ไม่ถูกต้อง');
  return v;
}
function choice_(v, allowed) { if (allowed.indexOf(v) < 0) throw new Error('ค่าที่เลือกไม่ถูกต้อง'); return v; }
function recordId_(v) { if (!/^rec[a-zA-Z0-9]{14}$/.test(v || '')) throw new Error('รหัสรายการไม่ถูกต้อง'); return v; }
function formulaValue_(v) { return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function manager_(u) { return u.role === 'Secretary' || u.role === 'Admin'; }
function requireManager_(u) { if (!manager_(u)) throw new Error('FORBIDDEN: เฉพาะเลขาฯ หรือผู้ดูแลระบบ'); }
function withLock_(fn) { var l = LockService.getScriptLock(); l.waitLock(30000); try { return fn(); } finally { l.releaseLock(); } }
function jsonForHtml_(v) { return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
