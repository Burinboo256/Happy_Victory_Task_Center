function queueNotification_(taskId, recipient, key, event, message) {
  return upsert_('notifications', 'Operation Key', { 'Operation Key': key, Task: taskId ? [taskId] : [], Recipient: [recipient], Channel: 'Email', 'Event Type': event, Message: message, 'Delivery Status': 'Pending' }).id;
}

// Disabled unless explicitly enabled in Script Properties. Install the trigger in the editor.
function dailyMaintenance_() {
  withLock_(function() {
    cleanupJournals_();
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('ENABLE_EMAIL_NOTIFICATIONS') !== 'true') return;
    var users = listAll_('users', '{Active}=1').map(userDto_), tasks = listAll_('tasks').map(taskDto_), day = today_();
    users.filter(manager_).forEach(function(u) {
      var key = 'daily:' + day + ':' + u.id;
      var exists = listAll_('notifications', '{Operation Key}=' + formulaValue_(key));
      if (exists.length) return;
      var open = tasks.filter(isOpen_), due = open.filter(function(t) { return t.dueDate === day; }), late = open.filter(function(t) { return t.dueDate && t.dueDate < day; }), follow = open.filter(function(t) { return t.followupDate && t.followupDate <= day; });
      var message = APP_.name + '\nสรุปประจำวันที่ ' + day + '\nงานคงค้าง ' + open.length + ' | เกินกำหนด ' + late.length + ' | ครบกำหนดวันนี้ ' + due.length + ' | ต้องติดตาม ' + follow.length;
      // No task titles or customer details in daily email; open the app for details.
      queueNotification_('', u.id, key, 'Daily Summary', message);
    });
  });
  sendQueuedNotifications_();
}

function sendQueuedNotifications_() {
  return withLock_(function() {
    if (PropertiesService.getScriptProperties().getProperty('ENABLE_EMAIL_NOTIFICATIONS') !== 'true') return;
    var records = listAll_('notifications', 'AND({Delivery Status}="Pending",{Channel}="Email")').slice(0, 25);
    records.forEach(function(r) {
      if (MailApp.getRemainingDailyQuota() < 1) return;
      var f = r.fields, recipientId = (f.Recipient || [])[0];
      if (!recipientId) return;
      var u = userDto_(getRecord_('users', recipientId));
      if (!u.active || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) { patchRecord_('notifications', r.id, { 'Delivery Status': 'Failed' }); return; }
      // Mark Sending first. Uncertain deliveries require manual review, never auto-resend.
      patchRecord_('notifications', r.id, { 'Delivery Status': 'Sending' });
      try {
        MailApp.sendEmail({ to: u.email, subject: '[HVR Task Center] ' + (f['Event Type'] || 'แจ้งเตือนงาน'), body: String(f.Message || '') + '\n\nเปิดระบบ: ' + oauthConfig_().redirect, name: APP_.name });
      } catch (e) { patchRecord_('notifications', r.id, { 'Delivery Status': 'Failed' }); return; }
      patchRecord_('notifications', r.id, { 'Delivery Status': 'Sent', 'Sent At': new Date().toISOString() });
    });
  });
}

function installDailyTrigger_() {
  // Editor-only execution: functions ending in underscore are private RPC helpers;
  // this public function also requires the script owner's interactive editor identity.
  if (!Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() !== Session.getEffectiveUser().getEmail()) throw new Error('เรียกฟังก์ชันนี้จาก Apps Script Editor ของเจ้าของโปรเจกต์');
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'dailyMaintenance_'; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyMaintenance_').timeBased().everyDays(1).atHour(8).inTimezone(APP_.timezone).create();
}
function cleanupJournals_() {
  var p = PropertiesService.getScriptProperties(), all = p.getProperties();
  Object.keys(all).filter(function(k) { return k.indexOf('operation:') === 0; }).forEach(function(k) {
    var j = JSON.parse(all[k]);
    // Keep unfinished operations for manual reconciliation, trim finished ones after 7 days.
    if (j.done && j.at < Date.now() - 7 * 86400000) p.deleteProperty(k);
  });
}
