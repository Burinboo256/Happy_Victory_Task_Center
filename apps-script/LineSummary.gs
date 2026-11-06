// Private editor / trigger functions only. Never accept a recipient or role from a browser.
function lineClock_(now) {
  return { day: Utilities.formatDate(now, APP_.timezone, 'yyyy-MM-dd'), hour: Number(Utilities.formatDate(now, APP_.timezone, 'H')) };
}
function lineScopedTasks_(u, tasks) {
  if (!u.active || ['Admin', 'Secretary', 'Agent'].indexOf(u.role) < 0) return [];
  return tasks.filter(function(t) { return manager_(u) || t.agentId === u.id; });
}
function lineScopeHash_(u, tasks) { return hash_(lineScopedTasks_(u, tasks).map(function(t) { return t.id; }).sort().join('|')); }
function lineDay_(timestamp) {
  var date = new Date(timestamp); return timestamp && !isNaN(date.getTime()) ? Utilities.formatDate(date, APP_.timezone, 'yyyy-MM-dd') : '';
}
function buildLineSummary_(u, tasks, users, day, round, appUrl) {
  choice_(round, ['Morning', 'Evening']);
  var scoped = lineScopedTasks_(u, tasks), pending = scoped.filter(isOpen_);
  var due = pending.filter(function(t) { return t.dueDate === day; });
  var follow = pending.filter(function(t) { return t.followupDate && t.followupDate <= day; });
  var late = pending.filter(function(t) { return t.dueDate && t.dueDate < day; });
  var completed = scoped.filter(function(t) { return t.status === 'Completed' && lineDay_(t.completedAt) === day; });
  function clean(v, max) { return String(v || '').replace(/[\r\n\t\u0000-\u001f]/g, ' ').slice(0, max); }
  function items(title, ts, dateKey) {
    var sorted = ts.slice().sort(function(a, b) { return (a[dateKey] || '').localeCompare(b[dateKey] || '') || a.code.localeCompare(b.code); });
    var lines = ['\n' + title + ': ' + ts.length + ' งาน'];
    sorted.slice(0, 4).forEach(function(t) {
      var owner = users.filter(function(v) { return v.id === t.agentId; })[0];
      lines.push('• ' + clean(t.code, 24) + ' ' + clean(t.title, 80) + (t.priority === 'Urgent' ? ' [ด่วนมาก]' : '') + (manager_(u) && owner ? ' — ' + clean(owner.name, 30) : '') + (t[dateKey] ? ' (' + clean(t[dateKey].slice(0, 10), 10) + ')' : ''));
    });
    if (ts.length > 4) lines.push('และอีก ' + (ts.length - 4) + ' งาน ดูทั้งหมดในระบบ');
    return lines.join('\n');
  }
  var message = APP_.name + '\n' + (round === 'Morning' ? 'รอบเช้า 08:00' : 'รอบเย็น 18:00') + ' · ' + day + ' (เวลาไทย)\n' + (manager_(u) ? 'ภาพรวมงานทั้งหมด' : 'งานของคุณ ' + clean(u.name, 60));
  message += items('📌 งานกำหนดส่งวันนี้', due, 'dueDate');
  message += items('🔔 งานต้องติดตามวันนี้ (รวมนัดค้าง)', follow, 'followupDate');
  message += '\n\n⏳ งานคงค้างทั้งหมด: ' + pending.length + ' งาน | เกินกำหนด ' + late.length + ' งาน';
  // All pending items, ordered by date; the overdue count remains explicit.
  message += items('รายการคงค้าง', pending, 'dueDate');
  message += items('✅ เสร็จวันนี้ ณ เวลาสรุป', completed, 'completedAt');
  message += '\n\nแต่ละหมวดอาจมีงานซ้ำกัน';
  if (/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(appUrl || '')) message += '\nเปิด Task Center: ' + appUrl;
  if (message.length > 4900) throw new Error('สรุป LINE ยาวเกินขนาดที่กำหนด');
  return message;
}
function lineRetryKey_(operation) {
  var h = hash_(operation); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-8' + h.slice(17, 20) + '-' + h.slice(20, 32);
}
function checkLineRecipients_(users) {
  var seen = {};
  users.forEach(function(u) {
    if (!u.lineId) return;
    if (!/^U[a-f0-9]{32}$/.test(u.lineId)) throw new Error('LINE User ID ของสมาชิกไม่ถูกต้อง กรุณาตรวจ Users');
    if (seen[u.lineId]) throw new Error('พบ LINE User ID ซ้ำ หยุดส่งเพื่อให้ผู้ดูแลตรวจ Users');
    seen[u.lineId] = true;
  });
}
function enqueueLineDigests_(users, tasks, existing, day, round) {
  checkLineRecipients_(users);
  var url = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || '';
  users.filter(function(u) { return u.active && u.lineEnabled && u.lineId && ['Admin', 'Secretary', 'Agent'].indexOf(u.role) >= 0; }).forEach(function(u) {
    var key = 'line-digest:' + day + ':' + round + ':' + u.id;
    if (existing.some(function(r) { return r.fields['Operation Key'] === key; })) return;
    var fields = { 'Operation Key': key, Task: [], Recipient: [u.id], Channel: 'LINE', 'Event Type': 'Daily Summary',
      Message: buildLineSummary_(u, tasks, users, day, round, url), 'Delivery Status': 'Pending',
      'Digest Date': day, 'Digest Round': round, 'LINE User ID': u.lineId, 'LINE Role': u.role,
      'LINE Retry Key': lineRetryKey_(key), 'Scope Fingerprint': lineScopeHash_(u, tasks) };
    // Do not overwrite an existing queued/sent snapshot if the previous write was ambiguous.
    existing.push(upsert_('notifications', 'Operation Key', fields));
  });
}
function lineFailure_(r, reason) { patchRecord_('notifications', r.id, { 'Delivery Status': 'Failed', 'Last Error': reason }); }
function dispatchLineDigests_(records, tasks, clock, accessToken, now) {
  var queue = records.filter(function(r) { return r.fields.Channel === 'LINE' && ['Pending', 'Sending'].indexOf(r.fields['Delivery Status']) >= 0; });
  var remaining = queue.length > 20;
  queue.slice(0, 20).forEach(function(r) {
    var f = r.fields, morning = f['Digest Round'] === 'Morning';
    if (f['Digest Date'] !== clock.day || (!morning && f['Digest Round'] !== 'Evening') || (morning ? clock.hour < 8 || clock.hour >= 18 : clock.hour < 18)) {
      lineFailure_(r, 'หมดรอบส่งแล้ว ระบบไม่ส่งรายงานย้อนหลัง'); return;
    }
    var u = userDto_(getRecord_('users', (f.Recipient || [])[0]));
    if (!u.active || !u.lineEnabled || u.lineId !== f['LINE User ID'] || u.role !== f['LINE Role'] || lineScopeHash_(u, tasks) !== f['Scope Fingerprint']) {
      lineFailure_(r, 'ผู้รับ สิทธิ์ หรือเจ้าของงานเปลี่ยนหลังสร้างรายงาน'); return;
    }
    if (!/^U[a-f0-9]{32}$/.test(u.lineId) || !/^[a-f0-9-]{36}$/.test(f['LINE Retry Key'] || '') || !f.Message || f.Message.length > 5000) {
      lineFailure_(r, 'รูปแบบผู้รับหรือข้อความไม่ถูกต้อง'); return;
    }
    var started = f['Delivery Started At'] || now.toISOString();
    if (now.getTime() - new Date(started).getTime() >= 23 * 3600000) { lineFailure_(r, 'หมดเวลาที่อนุญาตให้ retry'); return; }
    patchRecord_('notifications', r.id, { 'Delivery Status': 'Sending', 'Delivery Started At': started });
    var response;
    try {
      response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', { method: 'post', muteHttpExceptions: true, contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + accessToken, 'X-Line-Retry-Key': f['LINE Retry Key'] },
        payload: JSON.stringify({ to: u.lineId, messages: [{ type: 'text', text: f.Message }] }) });
    } catch (e) { remaining = true; patchRecord_('notifications', r.id, { 'Delivery Status': 'Pending', 'Last Error': 'เครือข่ายขัดข้อง จะลองใหม่ด้วย retry key เดิม' }); return; }
    var code = response.getResponseCode(), headers = response.getAllHeaders(), accepted = Object.keys(headers).some(function(k) { return k.toLowerCase() === 'x-line-accepted-request-id' && headers[k]; });
    if (code === 200 || (code === 409 && accepted)) {
      // Sent means LINE accepted the request; it does not prove delivery or that it was read.
      patchRecord_('notifications', r.id, { 'Delivery Status': 'Sent', 'Sent At': now.toISOString(), 'Last Error': '' });
    } else if (code >= 500) {
      remaining = true;
      patchRecord_('notifications', r.id, { 'Delivery Status': 'Pending', 'Last Error': 'LINE HTTP ' + code + ' จะลองใหม่ด้วย retry key เดิม' });
    } else lineFailure_(r, 'LINE HTTP ' + code + (code === 429 ? ' ตรวจโควตาหรือ rate limit ก่อน retry ด้วย key เดิม' : ' กรุณาตรวจการตั้งค่า'));
  });
  return remaining;
}
function runLineSummarySchedule_() {
  return withLock_(function() {
    var p = PropertiesService.getScriptProperties();
    if (p.getProperty('ENABLE_LINE_NOTIFICATIONS') !== 'true') return { enabled: false };
    var token = p.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    if (!token) throw new Error('กรุณาตั้ง LINE_CHANNEL_ACCESS_TOKEN');
    var now = new Date(), clock = lineClock_(now), round = clock.hour === 8 ? 'Morning' : clock.hour === 18 ? 'Evening' : '';
    if (!round) return { waiting: true };
    if (p.getProperty('line-drained:' + clock.day + ':' + round)) return { completed: true };
    // Light local marker prevents repeated schema/task reads after a successfully built round.
    var marker = 'line-built:' + clock.day + ':' + round;
    var shouldBuild = round && !p.getProperty(marker);
    var pending = listAll_('notifications', 'AND({Channel}="LINE",OR({Delivery Status}="Pending",{Delivery Status}="Sending"))');
    if (!shouldBuild && !pending.length) return { pending: 0 };
    var users = listAll_('users').map(userDto_); checkLineRecipients_(users);
    var tasks = listAll_('tasks').map(taskDto_);
    if (shouldBuild) {
      var existing = listAll_('notifications', 'AND({Channel}="LINE",{Digest Date}=' + formulaValue_(clock.day) + ',{Digest Round}=' + formulaValue_(round) + ')');
      enqueueLineDigests_(users, tasks, existing, clock.day, round);
      p.setProperty(marker, 'true');
      pending = listAll_('notifications', 'AND({Channel}="LINE",OR({Delivery Status}="Pending",{Delivery Status}="Sending"))');
    }
    if (!dispatchLineDigests_(pending, tasks, clock, token, now)) p.setProperty('line-drained:' + clock.day + ':' + round, 'true');
    Object.keys(p.getProperties()).filter(function(k) { return /^line-(built|drained):/.test(k) && k.split(':')[1] < clock.day; }).forEach(function(k) { p.deleteProperty(k); });
    return { enabled: true };
  });
}
function installLineSummaryTrigger_() {
  lineLoginConfig_();
  if (!PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN')) throw new Error('กรุณาตั้ง LINE_CHANNEL_ACCESS_TOKEN');
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'runLineSummarySchedule_'; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runLineSummarySchedule_').timeBased().everyMinutes(5).create();
}
function removeLineSummaryTrigger_() {
  PropertiesService.getScriptProperties().setProperty('ENABLE_LINE_NOTIFICATIONS', 'false');
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'runLineSummarySchedule_'; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
}
function resumeLineSummaryRound_() {
  // After an operator reviews Failed jobs and manually changes safe ones to Pending.
  var clock = lineClock_(new Date()), round = clock.hour === 8 ? 'Morning' : clock.hour === 18 ? 'Evening' : '';
  if (!round) throw new Error('ลองใหม่ได้เฉพาะช่วงรอบเช้า 08:00–08:59 หรือรอบเย็น 18:00–18:59 ตามเวลาไทย');
  PropertiesService.getScriptProperties().deleteProperty('line-drained:' + clock.day + ':' + round);
  return runLineSummarySchedule_();
}
