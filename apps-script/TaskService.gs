function taskDto_(r) {
  var f = r.fields;
  return { id: r.id, code: f['Task ID'] || r.id, title: f['Task Title'] || '', description: f.Description || '',
    agentId: (f.Agent || [])[0] || '', secretaryId: (f['Assigned Secretary'] || [])[0] || '',
    category: f.Category || 'งานทั่วไป', status: f.Status || 'New', priority: f.Priority || 'Normal',
    dueDate: f['Due Date'] || '', followupDate: f['Next Follow-up'] || '', createdAt: f['Created At'] || '',
    completedAt: f['Completed At'] || '', version: f['Last Update'] || '', referenceUrl: f['Reference URL'] || '',
    attachments: (f.Attachments || []).map(function(a) { return { name: a.filename || 'เอกสารแนบ', url: a.url || '' }; }) };
}
function isOpen_(t) { return t.status !== 'Completed' && t.status !== 'Cancelled'; }
function ownTask_(u, id) {
  var task = taskDto_(getRecord_('tasks', recordId_(id)));
  if (!manager_(u) && task.agentId !== u.id) throw new Error('FORBIDDEN: คุณไม่มีสิทธิ์เข้าถึงงานนี้');
  return task;
}
function bootstrap_(u, force) {
  var cache = CacheService.getScriptCache(), key = 'bootstrap:' + u.id + ':' + u.role + ':' + (PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || '0');
  if (force) cache.remove(key);
  var cached = cache.get(key); if (cached) return JSON.parse(cached);
  var filter = manager_(u) ? '' : '{Agent Record ID}=' + formulaValue_(u.id);
  var tasks = listAll_('tasks', filter).map(taskDto_).filter(function(t) { return manager_(u) || t.agentId === u.id; });
  var users = manager_(u) ? listAll_('users').map(userDto_).map(function(v) { var p = publicUser_(v); p.active = v.active; return p; }) : [publicUser_(u)];
  var result = { user: { id: u.id, name: u.name, role: u.role, email: u.email, lineLinked: !!u.lineId, lineEnabled: u.lineEnabled }, users: users, tasks: tasks, today: today_(), categories: APP_.categories, syncedAt: new Date().toISOString() };
  var serialized = JSON.stringify(result); if (serialized.length < 85000) cache.put(key, serialized, 30);
  return result;
}
function invalidateBootstrap_() {
  PropertiesService.getScriptProperties().setProperty('DATA_VERSION', random_().slice(0, 12));
}
function taskDetail_(u, id) {
  var task = ownTask_(u, id);
  var updates = listAll_('updates', '{Task Record ID}=' + formulaValue_(task.id)).filter(function(r) {
    return (r.fields.Task || []).indexOf(task.id) >= 0 && (manager_(u) || r.fields['Visible to Agent'] === true);
  }).map(function(r) {
    var f = r.fields;
    return { id: r.id, type: f['Update Type'], message: f.Message || '', actor: f['Actor Name'] || 'ผู้ใช้งาน', createdAt: f['Updated At'] || '', visible: f['Visible to Agent'] === true, oldStatus: f['Old Status'] || '', newStatus: f['New Status'] || '' };
  }).sort(function(a, b) { return a.createdAt.localeCompare(b.createdAt); });
  var followups = manager_(u) ? listAll_('followups', '{Task Record ID}=' + formulaValue_(task.id)).filter(function(r) { return (r.fields.Task || []).indexOf(task.id) >= 0; }).map(followupDto_) : [];
  return { task: task, updates: updates, followups: followups };
}
function logUpdate_(u, taskId, key, type, message, visible, oldStatus, newStatus) {
  return upsert_('updates', 'Operation Key', { 'Operation Key': key, Task: [taskId], 'Updated By': [u.id], 'Actor Name': u.name,
    'Update Type': type, Message: message, 'Visible to Agent': visible === true, 'Old Status': oldStatus || '', 'New Status': newStatus || '' }).id;
}
function checkVersion_(t, expected) {
  if (!expected || expected !== t.version) throw new Error('CONFLICT: งานนี้มีการแก้ไขแล้ว กรุณาปิดแล้วเปิดรายละเอียดใหม่');
}
function createTask_(u, d, step, key) {
  var title = text_(d.title, 180, true), description = text_(d.description, 5000, true);
  var priority = choice_(d.priority, APP_.priorities), category = choice_(d.category, APP_.categories), due = date_(d.dueDate, true);
  var reference = text_(d.referenceUrl || '', 2000, false);
  if (reference && !/^https:\/\/[^\s<>"']+$/i.test(reference)) throw new Error('ลิงก์อ้างอิงต้องขึ้นต้นด้วย https://');
  var owner = u.id;
  if (manager_(u)) {
    owner = recordId_(d.agentId);
    var agent = userDto_(getRecord_('users', owner));
    if (!agent.active || agent.role !== 'Agent') throw new Error('กรุณาเลือก Agent ที่เปิดใช้งาน');
  }
  // Agent-supplied owner, role and status fields are intentionally ignored.
  var id = step('task', function() {
    var existing = listAll_('tasks', '{Request Key}=' + formulaValue_(key));
    if (existing.length > 1) throw new Error('พบรหัสคำขอซ้ำ กรุณาติดต่อผู้ดูแล');
    if (existing.length) {
      if ((existing[0].fields.Agent || [])[0] !== owner) throw new Error('FORBIDDEN: เจ้าของงานไม่ตรงกับคำขอ');
      return existing[0].id;
    }
    return upsert_('tasks', 'Request Key', { 'Request Key': key, 'Task Title': title, Description: description, Agent: [owner],
      'Assigned Secretary': manager_(u) ? [u.id] : [], Category: category, Status: 'New', Priority: priority, 'Due Date': due, 'Reference URL': reference }).id;
  });
  step('audit', function() { return logUpdate_(u, id, key + ':audit', 'Created', 'ส่งงานใหม่: ' + title, true); });
  step('invalidate', function() { invalidateBootstrap_(); return true; });
  return { id: id };
}
function changeStatus_(u, d, step, key) {
  requireManager_(u);
  var status = choice_(d.status, APP_.statuses), message = text_(d.message || '', 2000, false);
  var snap = step('snapshot', function() { var t = ownTask_(u, d.id); checkVersion_(t, d.version); return { id: t.id, oldStatus: t.status, oldCompletedAt: t.completedAt, owner: t.agentId, title: t.title }; });
  step('patch', function() {
    var completedAt = status === 'Completed' ? (snap.oldStatus === 'Completed' ? snap.oldCompletedAt || null : new Date().toISOString()) : null;
    patchRecord_('tasks', snap.id, { Status: status, 'Completed At': completedAt }); return true;
  });
  step('audit', function() { return logUpdate_(u, snap.id, key + ':audit', 'Status', message || 'อัปเดตสถานะงาน', true, snap.oldStatus, status); });
  step('notification', function() { return queueNotification_(snap.id, snap.owner, key + ':notification', 'Status Changed', snap.title + '\nสถานะ: ' + status + (message ? '\n' + message : '')); });
  step('invalidate', function() { invalidateBootstrap_(); return true; });
  return { id: snap.id };
}
function addComment_(u, d, step, key) {
  var task = ownTask_(u, d.id), message = text_(d.message, 3000, true);
  var visible = manager_(u) ? d.visible !== false : true;
  step('audit', function() { return logUpdate_(u, task.id, key + ':audit', 'Comment', message, visible); });
  return { id: task.id };
}
