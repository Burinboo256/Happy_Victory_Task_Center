// All Airtable access stays on the server. Callers never supply a table name.
function airtable_(method, table, id, body, query) {
  var c = config_();
  var url = 'https://api.airtable.com/v0/' + encodeURIComponent(c.base) + '/' + encodeURIComponent(c.tables[table]);
  if (id) url += '/' + encodeURIComponent(recordId_(id));
  var q = Object.keys(query || {}).map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&');
  if (q) url += '?' + q;
  // Reserve a shared request slot. Mutation calls already own the script lock.
  // Separate rate lock is unavailable in Apps Script; use a single internal RPC lock.
  var cache = CacheService.getScriptCache();
  var last = Number(cache.get('airtable:next') || 0);
  if (last > Date.now()) Utilities.sleep(Math.min(last - Date.now(), 30000));
  cache.put('airtable:next', String(Date.now() + 230), 60);
  var options = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + c.token }, contentType: 'application/json' };
  if (body) options.payload = JSON.stringify(body);
  var res;
  try { res = UrlFetchApp.fetch(url, options); } catch (e) { throw new Error('ติดต่อ Airtable ไม่สำเร็จ กรุณาลองคำขอเดิมอีกครั้ง'); }
  var status = res.getResponseCode();
  if (status === 429 && (method === 'get' || method === 'patch')) {
    Utilities.sleep(30000);
    res = UrlFetchApp.fetch(url, options); status = res.getResponseCode();
  }
  if (status < 200 || status >= 300) {
    // Do not return upstream responses, request URLs or authorization details.
    throw new Error(status === 404 ? 'ไม่พบรายการ หรือชื่อ Table ไม่ตรงกับการตั้งค่า' : 'Airtable ตอบกลับ ' + status + ' กรุณาตรวจสิทธิ์ Token และโครงสร้างตาราง');
  }
  return JSON.parse(res.getContentText());
}

function listAll_(table, formula) {
  var out = [], offset, seen = {};
  do {
    var q = { pageSize: 100 }; if (formula) q.filterByFormula = formula; if (offset) q.offset = offset;
    var page = airtable_('get', table, '', null, q);
    out = out.concat(page.records || []); offset = page.offset;
    if (offset && seen[offset]) throw new Error('Airtable ส่ง pagination ซ้ำ กรุณาลองใหม่');
    if (offset) seen[offset] = true;
  } while (offset);
  return out;
}
function getRecord_(table, id) { return airtable_('get', table, id); }
function patchRecord_(table, id, fields) { return airtable_('patch', table, id, { fields: fields }); }
function upsert_(table, keyField, fields) {
  return airtable_('patch', table, '', { performUpsert: { fieldsToMergeOn: [keyField] }, records: [{ fields: fields }] }).records[0];
}
