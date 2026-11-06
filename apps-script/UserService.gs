function userDto_(r) {
  var f = r.fields;
  return { id: r.id, userId: f['User ID'] || '', name: f['Full Name'] || '', email: f.Email || '', role: f.Role, active: f.Active === true, sub: f['Google Subject'] || '', lineId: f['LINE User ID'] || '', lineEnabled: f['LINE Notifications'] === true };
}
function publicUser_(u) { return { id: u.id, name: u.name, role: u.role }; }
function findIdentity_(identity) {
  if (!identity.sub || !identity.email || identity.email_verified !== true) throw new Error('บัญชี Google ยังไม่ยืนยันอีเมล');
  var users = listAll_('users', 'OR({Google Subject}=' + formulaValue_(identity.sub) + ',LOWER({Email})=' + formulaValue_(identity.email.toLowerCase()) + ')');
  if (users.length !== 1) throw new Error('บัญชีนี้ยังไม่ได้รับอนุญาต หรือมีผู้ใช้ซ้ำ กรุณาติดต่อผู้ดูแลระบบ');
  var u = userDto_(users[0]);
  if (!u.active || ['Agent', 'Secretary', 'Admin'].indexOf(u.role) < 0) throw new Error('บัญชีนี้ถูกปิดใช้งาน');
  if (u.sub && u.sub !== identity.sub) throw new Error('บัญชี Google ไม่ตรงกับผู้ใช้ที่ลงทะเบียน');
  if (!u.sub) {
    // Auto-binding is restricted to Google's authoritative Gmail / Workspace identities.
    if (!/@gmail\.com$/i.test(identity.email) && !identity.hd) throw new Error('อีเมลภายนอก Google ต้องให้ผู้ดูแลตั้งค่า Google Subject ล่วงหน้า');
    patchRecord_('users', u.id, { 'Google Subject': identity.sub }); u.sub = identity.sub;
  }
  patchRecord_('users', u.id, { 'Last Login': new Date().toISOString() });
  return u;
}
function requireUser_(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('UNAUTHENTICATED: กรุณาเข้าสู่ระบบ');
  var key = 'session:' + hash_(token), raw = CacheService.getScriptCache().get(key);
  if (!raw) throw new Error('UNAUTHENTICATED: หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบอีกครั้ง');
  var s = JSON.parse(raw);
  if (s.expires <= Date.now()) { CacheService.getScriptCache().remove(key); throw new Error('UNAUTHENTICATED: หมดเวลาเข้าสู่ระบบ'); }
  // Always recheck role, active flag and stable Google identity, even on a cached session.
  var u = userDto_(getRecord_('users', s.userId));
  if (!u.active || !u.sub || u.sub !== s.sub || ['Agent', 'Secretary', 'Admin'].indexOf(u.role) < 0) throw new Error('FORBIDDEN: บัญชีไม่มีสิทธิ์เข้าใช้งาน');
  return u;
}
