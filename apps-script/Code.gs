function doGet(e) {
  var boot = { demo: false, name: APP_.name, view: e && e.parameter && e.parameter.view === 'create' ? 'create' : '', ticket: '', lineTicket: '', error: '' };
  try {
    if (e && e.parameter && (e.parameter.code || e.parameter.error || e.parameter.state)) {
      if (/^line[a-f0-9]{64}$/.test(e.parameter.state || '')) boot.lineTicket = lineCallback_(e);
      else boot.ticket = oauthCallback_(e).ticket;
    }
  }
  catch (err) { boot.error = err.message; }
  var template = HtmlService.createTemplateFromFile('Index');
  template.bootJson = jsonForHtml_(boot);
  return template.evaluate().setTitle(APP_.name).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function include_(file) { return HtmlService.createHtmlOutputFromFile(file).getContent(); }

// One small public RPC surface; every data route authenticates on the server.
function api(token, action, payload) {
  return withLock_(function() {
    var u = requireUser_(token), data = payload || {};
    switch (action) {
      case 'bootstrap': return bootstrap_(u, data.force === true);
      case 'detail': return taskDetail_(u, data.id);
      case 'linePreference':
        if (typeof data.enabled !== 'boolean' || (data.enabled && !/^U[a-f0-9]{32}$/.test(u.lineId))) throw new Error('กรุณาเชื่อมบัญชี LINE ก่อนเปิดรับสรุป');
        patchRecord_('users', u.id, { 'LINE Notifications': data.enabled }); invalidateBootstrap_(); return true;
      case 'create': return mutation_(u, action, data, function(step, key) { return createTask_(u, data, step, key); });
      case 'status': return mutation_(u, action, data, function(step, key) { return changeStatus_(u, data, step, key); });
      case 'comment': return mutation_(u, action, data, function(step, key) { return addComment_(u, data, step, key); });
      case 'followup': return mutation_(u, action, data, function(step, key) { return scheduleFollowup_(u, data, step, key); });
      case 'resolveFollowup': return mutation_(u, action, data, function(step, key) { return resolveFollowup_(u, data, step, key); });
      default: throw new Error('ไม่พบคำสั่งนี้');
    }
  });
}

// Persist a short saga journal so retrying a partially completed operation resumes it.
// Airtable upserts use deterministic keys to handle ambiguous network responses.
function mutation_(u, action, data, fn) {
  if (PropertiesService.getScriptProperties().getProperty('ENABLE_TASK_WRITES') === 'false') {
    throw new Error('MAINTENANCE: ระบบเดิมพักการบันทึกงาน กรุณาเปิดเว็บใหม่จากเมนู LINE ของทีม');
  }
  if (!/^[a-f0-9-]{16,80}$/.test(data.requestId || '')) throw new Error('กรุณาส่งรหัสคำขอที่ถูกต้อง');
  var props = PropertiesService.getScriptProperties(), key = 'operation:' + hash_(u.id + ':' + data.requestId);
  var fingerprint = hash_(action + JSON.stringify(data)), old = props.getProperty(key);
  var journal = old ? JSON.parse(old) : { fingerprint: fingerprint, at: Date.now(), resource: data.id || '', steps: {} };
  if (journal.fingerprint !== fingerprint) throw new Error('คำขอเดิมมีข้อมูลเปลี่ยนไป กรุณาส่งเป็นคำขอใหม่');
  if (journal.done) return journal.result;
  if (journal.resource) {
    var all = props.getProperties();
    Object.keys(all).filter(function(k) { return k.indexOf('operation:') === 0 && k !== key; }).forEach(function(k) {
      var other = JSON.parse(all[k]);
      if (!other.done && other.resource === journal.resource && Object.keys(other.steps).length) throw new Error('งานนี้มีคำขอที่ยังบันทึกไม่ครบ กรุณาลองส่งคำขอเดิมให้สำเร็จ หรือติดต่อผู้ดูแล');
    });
  }
  props.setProperty(key, JSON.stringify(journal));
  function step(name, work) {
    if (Object.prototype.hasOwnProperty.call(journal.steps, name)) return journal.steps[name];
    var result = work(); journal.steps[name] = result === undefined ? true : result;
    props.setProperty(key, JSON.stringify(journal)); return journal.steps[name];
  }
  var result = fn(step, key);
  journal.done = true; journal.result = result; props.setProperty(key, JSON.stringify(journal));
  return result;
}
