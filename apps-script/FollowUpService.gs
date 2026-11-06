function followupDto_(r) {
  var f = r.fields;
  return { id: r.id, taskId: (f.Task || [])[0], date: f['Follow-up Date'] || '', status: f['Follow-up Status'] || 'Pending', notes: f['Result / Notes'] || '', completedAt: f['Completed At'] || '' };
}
function recomputeFollowup_(taskId) {
  var pending = listAll_('followups', 'AND({Task Record ID}=' + formulaValue_(taskId) + ',{Follow-up Status}="Pending")')
    .map(followupDto_).filter(function(f) { return f.taskId === taskId && f.status === 'Pending' && f.date; }).map(function(f) { return f.date.slice(0, 10); }).sort();
  patchRecord_('tasks', taskId, { 'Next Follow-up': pending[0] || null });
  return true;
}
function scheduleFollowup_(u, d, step, key) {
  requireManager_(u);
  var day = date_(d.date, true), notes = text_(d.notes || '', 2000, false);
  var snapshot = step('snapshot', function() { var t = ownTask_(u, d.id); if (!isOpen_(t)) throw new Error('งานปิดแล้ว ไม่สามารถเพิ่มนัดติดตาม'); return { id: t.id }; });
  step('followup', function() { return upsert_('followups', 'Operation Key', { 'Operation Key': key, Task: [snapshot.id], 'Follow-up Date': day, 'Assigned To': [u.id], 'Follow-up Status': 'Pending', 'Result / Notes': notes }).id; });
  step('next', function() { return recomputeFollowup_(snapshot.id); });
  step('audit', function() { return logUpdate_(u, snapshot.id, key + ':audit', 'Follow-up', 'นัดติดตาม ' + day + (notes ? '\n' + notes : ''), false); });
  step('invalidate', function() { invalidateBootstrap_(); return true; });
  return { id: snapshot.id };
}
function resolveFollowup_(u, d, step, key) {
  requireManager_(u);
  var task = ownTask_(u, d.id), status = choice_(d.status, ['Done', 'Skipped']), notes = text_(d.notes || '', 2000, status === 'Done');
  var followup = followupDto_(getRecord_('followups', recordId_(d.followupId)));
  if (followup.taskId !== task.id) throw new Error('FORBIDDEN: นัดติดตามไม่ตรงกับงาน');
  step('resolve', function() {
    if (followup.status !== 'Pending') throw new Error('นัดติดตามนี้ถูกปิดแล้ว กรุณาโหลดใหม่');
    patchRecord_('followups', followup.id, { 'Follow-up Status': status, 'Result / Notes': notes, 'Completed At': new Date().toISOString() }); return true;
  });
  step('next', function() { return recomputeFollowup_(task.id); });
  step('audit', function() { return logUpdate_(u, task.id, key + ':audit', 'Follow-up', (status === 'Done' ? 'ติดตามแล้ว: ' : 'ข้ามนัดติดตาม: ') + notes, false); });
  step('invalidate', function() { invalidateBootstrap_(); return true; });
  return { id: task.id };
}
