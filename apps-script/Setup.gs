// Run from the editor. Browser executions must match the deploying Google identity.
// Apps Script hides underscore-suffixed functions from its Run menu.
function initializeProject() { return initializeProject_(); }
function checkDeployment() { return checkDeployment_(); }

function requireEditor_() {
  var owner = Session.getEffectiveUser().getEmail();
  if (!owner || Session.getActiveUser().getEmail() !== owner) {
    throw new Error('เรียกฟังก์ชันนี้จาก Apps Script Editor ของเจ้าของโปรเจกต์');
  }
}

function projectDefaults_() {
  return {
    AIRTABLE_BASE_ID: 'appDS1Ji5cqIohPq3',
    AIRTABLE_USERS_TABLE: 'tblemecj9kN239Qkg',
    AIRTABLE_TASKS_TABLE: 'tblD50c8x4jdMfFxL',
    AIRTABLE_UPDATES_TABLE: 'tblzjket6kipuC6TO',
    AIRTABLE_FOLLOWUPS_TABLE: 'tblpbrXJdaMAbRiSB',
    AIRTABLE_NOTIFICATIONS_TABLE: 'tblypoT8bDsAkjMCP',
    ENABLE_EMAIL_NOTIFICATIONS: 'false',
    ENABLE_LINE_NOTIFICATIONS: 'false'
  };
}

function initializeProject_() {
  requireEditor_();
  return withLock_(function() {
    var props = PropertiesService.getScriptProperties(), defaults = projectDefaults_();
    var keys = Object.keys(defaults), added = [];
    // Refuse mixed base/table mappings before making any changes.
    keys.filter(function(k) { return k.indexOf('AIRTABLE_') === 0; }).forEach(function(k) {
      var current = props.getProperty(k);
      if (current && current !== defaults[k]) throw new Error('ตรวจค่า ' + k + ' ก่อนตั้งค่า Base นี้ ไม่มีการเปลี่ยนแปลง');
    });
    keys.forEach(function(k) {
      if (!props.getProperty(k)) { props.setProperty(k, defaults[k]); added.push(k); }
    });
    var result = { added: added, note: 'เพิ่มเฉพาะค่าที่ขาด ไม่สร้าง records หรือ triggers และไม่ส่งข้อความ' };
    console.log(JSON.stringify(result));
    return result;
  });
}

function checkDeployment_() {
  requireEditor_();
  return withLock_(function() {
    var props = PropertiesService.getScriptProperties(), checks = [];
    function add(name, ok, detail) { checks.push({ name: name, ok: ok, detail: detail }); }
    var required = ['AIRTABLE_TOKEN', 'AIRTABLE_BASE_ID', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'WEB_APP_URL'];
    required.forEach(function(k) { add(k, !!(props.getProperty(k) || '').trim(), 'ต้องตั้งใน Script Properties'); });
    var timezone = Session.getScriptTimeZone();
    add('Timezone', timezone === APP_.timezone, 'ต้องเป็น ' + APP_.timezone);
    var url = props.getProperty('WEB_APP_URL') || '';
    add('Web app URL', /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url), 'ใช้ deployment URL ลงท้าย /exec');
    var clientId = props.getProperty('GOOGLE_CLIENT_ID') || '';
    add('Google OAuth client', /^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId), 'ใช้ Web application client');
    ['ENABLE_EMAIL_NOTIFICATIONS', 'ENABLE_LINE_NOTIFICATIONS'].forEach(function(k) {
      var value = props.getProperty(k);
      add(k, value === null || value === 'false' || value === 'true', 'ตั้ง true หรือ false; เปิดเมื่อทดสอบผู้รับแล้วเท่านั้น');
    });
    if (props.getProperty('ENABLE_LINE_NOTIFICATIONS') === 'true') {
      ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_LOGIN_CHANNEL_ID', 'LINE_LOGIN_CHANNEL_SECRET'].forEach(function(k) {
        add(k, !!(props.getProperty(k) || '').trim(), 'จำเป็นเมื่อเปิดสรุป LINE');
      });
    }
    var baseId = props.getProperty('AIRTABLE_BASE_ID') || '';
    add('Airtable base ID', /^app[A-Za-z0-9]{14}$/.test(baseId), 'ใช้ Base ID ไม่ใช่ invitation URL');
    var apiReady = !!(props.getProperty('AIRTABLE_TOKEN') || '').trim() && /^app[A-Za-z0-9]{14}$/.test(baseId);
    if (apiReady) {
      // Probe each configured table with one GET. Never log response bodies or secrets.
      ['users', 'tasks', 'updates', 'followups', 'notifications'].forEach(function(table) {
        try {
          airtable_('get', table, '', null, { pageSize: 1, maxRecords: 1 });
          add('Airtable ' + table, true, 'อ่านตารางได้; ไม่ได้ตรวจ write scope หรือ schema ทั้งหมด');
        } catch (err) {
          add('Airtable ' + table, false, 'อ่านตารางไม่สำเร็จ ตรวจ PAT, Base access และ Table ID');
        }
      });
    } else add('Airtable connection', false, 'ตั้ง PAT และ Base ID ที่ถูกต้องก่อนตรวจ API');
    var report = { configurationReady: checks.every(function(c) { return c.ok; }), checks: checks,
      acceptanceTestsRequired: ['Google Login สองบัญชี', 'Users Active / Role และสิทธิ์เจ้าของงาน', 'สร้างงานและบันทึกประวัติบน Base ทดสอบ'],
      note: 'ตรวจค่าติดตั้งและสิทธิ์อ่านเท่านั้น ยังไม่ยืนยัน OAuth, write scope, ผู้ใช้จริง หรือการส่งแจ้งเตือน' };
    console.log(JSON.stringify(report));
    return report;
  });
}
