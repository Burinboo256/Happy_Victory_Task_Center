function lineLoginConfig_() {
  var p = PropertiesService.getScriptProperties();
  var c = { id: p.getProperty('LINE_LOGIN_CHANNEL_ID'), secret: p.getProperty('LINE_LOGIN_CHANNEL_SECRET'), redirect: p.getProperty('WEB_APP_URL') };
  if (!c.id || !c.secret || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(c.redirect || '')) throw new Error('กรุณาตั้งค่า LINE Login และ WEB_APP_URL ตามคู่มือ LINE OA');
  return c;
}
function startLineLink(token, challenge) {
  return withLock_(function() {
    var u = requireUser_(token), c = lineLoginConfig_();
    if (!/^[a-f0-9]{64}$/.test(challenge || '')) throw new Error('ข้อมูลเริ่มเชื่อม LINE ไม่ถูกต้อง');
    var state = 'line' + random_();
    CacheService.getScriptCache().put('line-state:' + hash_(state), JSON.stringify({ userId: u.id, session: hash_(token), challenge: challenge }), 600);
    var params = { response_type: 'code', client_id: c.id, redirect_uri: c.redirect, state: state, scope: 'profile', bot_prompt: 'normal', prompt: 'login' };
    return 'https://access.line.me/oauth2/v2.1/authorize?' + Object.keys(params).map(function(k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  });
}
function lineCallback_(e) {
  var p = e.parameter || {}, c = lineLoginConfig_();
  var state = withLock_(function() {
    var cache = CacheService.getScriptCache(), key = 'line-state:' + hash_(p.state), raw = cache.get(key);
    cache.remove(key); if (!raw) throw new Error('คำขอเชื่อม LINE หมดอายุหรือใช้แล้ว กรุณาเริ่มใหม่'); return JSON.parse(raw);
  });
  if (p.error || !p.code) throw new Error('ยกเลิกการเชื่อม LINE');
  var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/token', { method: 'post', muteHttpExceptions: true, payload: { grant_type: 'authorization_code', code: p.code, redirect_uri: c.redirect, client_id: c.id, client_secret: c.secret } });
  if (res.getResponseCode() !== 200) throw new Error('LINE ยืนยันบัญชีไม่สำเร็จ กรุณาเริ่มใหม่');
  var access = JSON.parse(res.getContentText()).access_token;
  if (!access) throw new Error('ไม่พบข้อมูลยืนยันบัญชี LINE');
  var profile = UrlFetchApp.fetch('https://api.line.me/v2/profile', { headers: { Authorization: 'Bearer ' + access }, muteHttpExceptions: true });
  if (profile.getResponseCode() !== 200) throw new Error('อ่านบัญชี LINE ไม่สำเร็จ');
  var lineId = JSON.parse(profile.getContentText()).userId;
  if (!/^U[a-f0-9]{32}$/.test(lineId || '')) throw new Error('LINE User ID ไม่ถูกต้อง');
  state.lineId = lineId;
  var ticket = random_();
  CacheService.getScriptCache().put('line-ticket:' + hash_(ticket), JSON.stringify(state), 120);
  return ticket;
}
function completeLineLink(token, ticket, verifier) {
  return withLock_(function() {
    var u = requireUser_(token);
    if (!/^[a-f0-9]{64}$/.test(ticket || '') || !/^[a-f0-9]{64}$/.test(verifier || '')) throw new Error('กรุณาเชื่อม LINE จากเบราว์เซอร์เดิม');
    var cache = CacheService.getScriptCache(), key = 'line-ticket:' + hash_(ticket), raw = cache.get(key);
    if (!raw) throw new Error('คำขอเชื่อม LINE หมดอายุ กรุณาเริ่มใหม่');
    var t = JSON.parse(raw);
    if (u.id !== t.userId || hash_(token) !== t.session || hash_(verifier) !== t.challenge) throw new Error('FORBIDDEN: บัญชีหรือเบราว์เซอร์ไม่ตรงกับคำขอเชื่อม LINE');
    var duplicates = listAll_('users', '{LINE User ID}=' + formulaValue_(t.lineId)).filter(function(r) { return r.id !== u.id && r.fields['LINE User ID'] === t.lineId; });
    if (duplicates.length) throw new Error('บัญชี LINE นี้ผูกกับสมาชิกคนอื่นแล้ว กรุณาติดต่อผู้ดูแล');
    patchRecord_('users', u.id, { 'LINE User ID': t.lineId, 'LINE Notifications': true });
    cache.remove(key); invalidateBootstrap_(); return true;
  });
}
