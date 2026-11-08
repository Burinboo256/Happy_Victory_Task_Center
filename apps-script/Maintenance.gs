// Guarded Run-menu wrappers follow Setup.gs; core helpers remain private to client RPC.
function checkLegacyCutover() { return legacyCutoverStatus_(); }
function pauseLegacyWritesForVercel() { return pauseLegacyWritesForVercel_(); }

function legacyCutoverSummary_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('AIRTABLE_BASE_ID') !== 'appDS1Ji5cqIohPq3') {
    throw new Error('Cutover requires the configured production Base');
  }
  var all = props.getProperties(), pending = 0, malformed = 0;
  Object.keys(all).filter(function(key) { return key.indexOf('operation:') === 0; }).forEach(function(key) {
    try { if (JSON.parse(all[key]).done !== true) pending++; }
    catch (err) { malformed++; }
  });
  var result = {
    taskWritesPaused: props.getProperty('ENABLE_TASK_WRITES') === 'false',
    emailEnabled: props.getProperty('ENABLE_EMAIL_NOTIFICATIONS') === 'true',
    lineEnabled: props.getProperty('ENABLE_LINE_NOTIFICATIONS') === 'true',
    pendingOperations: pending,
    malformedOperations: malformed,
    triggerCount: ScriptApp.getProjectTriggers().length
  };
  result.readyToCutover = result.taskWritesPaused && !result.emailEnabled && !result.lineEnabled && pending === 0 && malformed === 0 && result.triggerCount === 0;
  return result;
}

function legacyCutoverStatus_() {
  requireEditor_();
  return withLock_(function() {
    var result = legacyCutoverSummary_();
    console.log(JSON.stringify(result));
    return result;
  });
}

function pauseLegacyWritesForVercel_() {
  requireEditor_();
  return withLock_(function() {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('AIRTABLE_BASE_ID') !== 'appDS1Ji5cqIohPq3') {
      throw new Error('Cutover requires the configured production Base');
    }
    props.setProperty('ENABLE_TASK_WRITES', 'false');
    props.setProperty('ENABLE_EMAIL_NOTIFICATIONS', 'false');
    props.setProperty('ENABLE_LINE_NOTIFICATIONS', 'false');
    var result = legacyCutoverSummary_();
    console.log(JSON.stringify(result));
    return result;
  });
}
