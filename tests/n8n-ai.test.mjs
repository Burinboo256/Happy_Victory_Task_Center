import test from 'node:test';
import assert from 'node:assert/strict';
import { workflow } from '../tools/build-n8n-ai.mjs';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
test('n8n AI template keeps signatures intact, does not retain executions and has no task write tools',()=>{
  assert.equal(workflow.active,false);
  assert.equal(workflow.settings.saveDataErrorExecution,'none');
  assert.equal(workflow.settings.saveDataSuccessExecution,'none');
  assert.equal(workflow.settings.saveManualExecutions,false);
  assert.equal(workflow.nodes.find(n=>n.type.endsWith('.webhook')).parameters.options.rawBody,true);
  assert.equal(workflow.nodes.find(n=>n.type.endsWith('.webhook')).parameters.responseMode,'onReceived');
  // n8n rejects immediate responses when any downstream Respond node exists,
  // including a disabled one. Keep the processing path connected without it.
  assert.equal(workflow.nodes.some(n=>n.type.endsWith('.respondToWebhook')),false);
  assert.equal(workflow.connections['Authorize and read cases'].main[0][0].node,'Questions');
  const raw=workflow.nodes.find(n=>n.name==='Preserve signed body');
  assert.match(raw.parameters.jsCode,/getBinaryDataBuffer/);
  for(const node of workflow.nodes) {
    if(node.type.endsWith('.code')) assert.doesNotThrow(()=>new AsyncFunction(node.parameters.jsCode));
    if(node.type.endsWith('.httpRequest')) assert.ok([
      'https://happy-victory-task-center.vercel.app/api/ai/line',
      'https://happy-victory-task-center.vercel.app/api/ai/reply',
      'https://openrouter.ai/api/v1/chat/completions',
    ].includes(node.parameters.url));
    assert.equal(node.credentials,undefined);
  }
  const model=workflow.nodes.find(n=>n.name==='OpenRouter');
  assert.equal(model.parameters.genericAuthType,'httpHeaderAuth');
  assert.equal(model.onError,'continueRegularOutput');
  assert.match(model.parameters.jsonBody,/data_collection:'deny'/);
});
