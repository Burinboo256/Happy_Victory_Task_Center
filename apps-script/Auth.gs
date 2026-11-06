// OAuth authorization-code flow runs at top level, outside the HTML Service iframe.
// No browser-provided identity, ID token payload, email or role is trusted.
function startGoogleLogin(challenge) {
  if (typeof challenge !== 'string' || !/^[a-f0-9]{64}$/.test(challenge)) throw new Error('ข้อมูลเริ่มเข้าสู่ระบบไม่ถูกต้อง');
  var c = oauthConfig_(), state = random_();
  CacheService.getScriptCache().put('oauth:' + hash_(state), challenge, 600);
  var params = { client_id: c.clientId, redirect_uri: c.redirect, response_type: 'code', scope: 'openid email profile', state: state, prompt: 'select_account', access_type: 'online' };
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + Object.keys(params).map(function(k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
}

function oauthCallback_(e) {
  var c = oauthConfig_(), p = e.parameter || {};
  if (!/^[a-f0-9]{64}$/.test(p.state || '')) throw new Error('การเข้าสู่ระบบไม่ถูกต้อง กรุณาเริ่มใหม่');
  var challenge = withLock_(function() {
    var cache = CacheService.getScriptCache(), k = 'oauth:' + hash_(p.state), v = cache.get(k);
    cache.remove(k); if (!v) throw new Error('คำขอเข้าสู่ระบบหมดอายุหรือถูกใช้แล้ว'); return v;
  });
  if (p.error || !p.code) throw new Error('การเข้าสู่ระบบถูกยกเลิก');
  var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { code: p.code, client_id: c.clientId, client_secret: c.secret, redirect_uri: c.redirect, grant_type: 'authorization_code' }
  });
  if (response.getResponseCode() !== 200) throw new Error('ไม่สามารถยืนยันบัญชี Google ได้ กรุณาเข้าสู่ระบบใหม่');
  var access = JSON.parse(response.getContentText()).access_token;
  if (!access) throw new Error('Google ไม่ได้ส่งข้อมูลยืนยันตัวตน');
  var info = UrlFetchApp.fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + access }, muteHttpExceptions: true });
  if (info.getResponseCode() !== 200) throw new Error('ไม่สามารถอ่านข้อมูลยืนยันบัญชี Google');
  // UserInfo is fetched directly from Google using the server-exchanged access token.
  // We deliberately do not decode or accept an unsigned ID token.
  var identity = JSON.parse(info.getContentText());
  var u = withLock_(function() { return findIdentity_(identity); });
  var ticket = random_();
  CacheService.getScriptCache().put('ticket:' + hash_(ticket), JSON.stringify({ userId: u.id, sub: u.sub, challenge: challenge }), 120);
  return { ticket: ticket };
}

function completeGoogleLogin(ticket, verifier) {
  return withLock_(function() {
    if (!/^[a-f0-9]{64}$/.test(ticket || '') || !/^[a-f0-9]{64}$/.test(verifier || '')) throw new Error('กรุณาเริ่มเข้าสู่ระบบจากเบราว์เซอร์เดิม');
    var cache = CacheService.getScriptCache(), k = 'ticket:' + hash_(ticket), raw = cache.get(k);
    if (!raw) throw new Error('การเข้าสู่ระบบหมดอายุ กรุณาลองใหม่');
    var t = JSON.parse(raw);
    if (hash_(verifier) !== t.challenge) throw new Error('กรุณาเข้าสู่ระบบด้วยเบราว์เซอร์ที่เริ่มคำขอ');
    cache.remove(k);
    var u = userDto_(getRecord_('users', t.userId));
    if (!u.active || u.sub !== t.sub) throw new Error('บัญชีไม่มีสิทธิ์เข้าใช้งาน');
    var token = random_();
    cache.put('session:' + hash_(token), JSON.stringify({ userId: u.id, sub: u.sub, expires: Date.now() + APP_.sessionSeconds * 1000 }), APP_.sessionSeconds);
    return { token: token };
  });
}

function logout(token) { if (/^[a-f0-9]{64}$/.test(token || '')) CacheService.getScriptCache().remove('session:' + hash_(token)); return true; }
