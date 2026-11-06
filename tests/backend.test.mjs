import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const files=fs.readdirSync(path.join(root,'apps-script')).filter(n=>n.endsWith('.gs'));
const source=files.map(n=>fs.readFileSync(path.join(root,'apps-script',n),'utf8')).join('\n');
const rid=n=>'rec'+String(n).padStart(14,'0');
const clone=x=>JSON.parse(JSON.stringify(x));
function harness(){
  const properties=new Map(),cache=new Map(),calls=[],db={users:[],tasks:[],updates:[],followups:[],notifications:[]};
  const p={getProperty:k=>properties.get(k)||null,setProperty(k,v){properties.set(k,v);},deleteProperty:k=>properties.delete(k),getProperties:()=>Object.fromEntries(properties)};
  const c={get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)};
  const ctx=vm.createContext({ console, Date, JSON, Math, Object, String, Number, Array, RegExp, Error,
    PropertiesService:{getScriptProperties:()=>p},CacheService:{getScriptCache:()=>c},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    Utilities:{getUuid:()=>crypto.randomUUID(),computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},sleep(){},formatDate:()=>new Date().toISOString().slice(0,10)},
    UrlFetchApp:{fetch(){throw new Error('Unexpected HTTP call');}},MailApp:{sendEmail(){throw new Error('Email not expected');}},
  });
  vm.runInContext(source,ctx);
  // Model API persistence while intentionally returning overly broad query results.
  // The authorization layer must still enforce exact ownership after formula filtering.
  ctx.listAll_=(table,formula)=>{calls.push(['list',table,formula]);return clone(db[table]);};
  ctx.getRecord_=(table,id)=>{calls.push(['get',table,id]);const r=db[table].find(r=>r.id===id);if(!r)throw new Error('not found');return clone(r);};
  ctx.patchRecord_=(table,id,fields)=>{calls.push(['patch',table,id,clone(fields)]);const r=db[table].find(r=>r.id===id);Object.assign(r.fields,clone(fields));if(table==='tasks')r.fields['Last Update']=crypto.randomUUID();return clone(r);};
  ctx.upsert_=(table,key,fields)=>{calls.push(['upsert',table,key,clone(fields)]);let r=db[table].find(r=>r.fields[key]===fields[key]);if(!r){r={id:rid(1000+db[table].length),fields:{}};db[table].push(r);}Object.assign(r.fields,clone(fields));return clone(r);};
  const users=[{id:rid(1),fields:{'User ID':'S001','Full Name':'เลขาฯ',Email:'secretary@gmail.com',Role:'Secretary',Active:true,'Google Subject':'sub-secretary'}},{id:rid(2),fields:{'User ID':'A001','Full Name':'Agent One',Email:'agent1@gmail.com',Role:'Agent',Active:true,'Google Subject':'sub-one'}},{id:rid(3),fields:{'User ID':'A002','Full Name':'Agent Two',Email:'agent2@gmail.com',Role:'Agent',Active:true,'Google Subject':'sub-two'}}];
  db.users=users;
  db.tasks=[{id:rid(11),fields:{'Task ID':'HVR-00001','Task Title':'Own task',Description:'description',Agent:[rid(2)],Status:'New',Priority:'Normal','Due Date':'2026-11-04','Last Update':'v1'}},{id:rid(12),fields:{'Task ID':'HVR-00002','Task Title':'Other task',Agent:[rid(3)],Status:'New',Priority:'Normal','Last Update':'v1'}}];
  const tokens={};
  for(const r of users){const token=crypto.randomBytes(32).toString('hex');tokens[r.fields.Role==='Secretary'?'secretary':r.id===rid(2)?'one':'two']=token;cache.set('session:'+ctx.hash_(token),JSON.stringify({userId:r.id,sub:r.fields['Google Subject'],expires:Date.now()+100000}));}
  function call(who,action,payload={}){return clone(ctx.api(tokens[who],action,payload));}
  return {ctx,db,cache,properties,calls,tokens,call};
}
test('unauthenticated RPC is rejected before reading Airtable',()=>{const h=harness();assert.throws(()=>h.ctx.api('', 'bootstrap',{}),/UNAUTHENTICATED/);assert.equal(h.calls.length,0);});
test('Agent bootstrap strips other owners even if upstream filter is broad',()=>{const h=harness();const out=h.call('one','bootstrap');assert.deepEqual(out.tasks.map(t=>t.id),[rid(11)]);assert.deepEqual(out.users.map(u=>u.id),[rid(2)]);assert.equal(out.users[0].email,undefined);assert.match(h.calls.find(c=>c[1]==='tasks')[2],/Agent Record ID/);});
test('Secretary sees all tasks',()=>{const h=harness();assert.equal(h.call('secretary','bootstrap').tasks.length,2);});
test('Agent cannot read details or comment on another owner task',()=>{const h=harness();for(const action of ['detail','comment'])assert.throws(()=>h.call('one',action,{id:rid(12),message:'x',requestId:crypto.randomUUID()}),/FORBIDDEN/);assert.equal(h.db.updates.length,0);});
test('Agent cannot mutate statuses, follow-up schedules or results',()=>{const h=harness();for(const action of ['status','followup','resolveFollowup'])assert.throws(()=>h.call('one',action,{id:rid(11),status:'Completed',date:'2026-11-04',requestId:crypto.randomUUID()}),/FORBIDDEN/);assert.equal(h.db.tasks[0].fields.Status,'New');});
test('role, identity and active flag are rechecked even when bootstrap is cached',()=>{const h=harness();h.call('one','bootstrap');h.db.users[1].fields.Active=false;assert.throws(()=>h.call('one','bootstrap'),/FORBIDDEN/);h.db.users[1].fields.Active=true;h.db.users[1].fields['Google Subject']='different';assert.throws(()=>h.call('one','bootstrap'),/FORBIDDEN/);});
test('internal updates are hidden from Agents and mismatched Task links are excluded',()=>{const h=harness();h.db.updates=[{id:rid(30),fields:{Task:[rid(11)],Message:'shared','Visible to Agent':true}},{id:rid(31),fields:{Task:[rid(11)],Message:'private','Visible to Agent':false}},{id:rid(32),fields:{Task:[rid(12)],Message:'other','Visible to Agent':true}}];assert.deepEqual(h.call('one','detail',{id:rid(11)}).updates.map(x=>x.message),['shared']);assert.equal(h.call('secretary','detail',{id:rid(11)}).updates.length,2);});
test('Agent comment cannot be made private by a forged payload',()=>{const h=harness();h.call('one','comment',{id:rid(11),message:'hello',visible:false,requestId:crypto.randomUUID()});assert.equal(h.db.updates[0].fields['Visible to Agent'],true);});
test('create ignores forged Agent identity and initial status; replay is idempotent',()=>{const h=harness();const original=h.ctx.listAll_;h.ctx.listAll_=(table,formula)=>table==='tasks'&&formula?.includes('Request Key')?h.db.tasks.filter(t=>formula.includes(t.fields['Request Key']||'NEVER')):original(table,formula);const payload={title:'New task',description:'Detailed request',category:'งานทั่วไป',priority:'Normal',dueDate:'2026-11-05',agentId:rid(3),status:'Completed',requestId:crypto.randomUUID()};const first=h.call('one','create',payload),second=h.call('one','create',payload);assert.deepEqual(first,second);assert.equal(h.db.tasks.length,3);assert.equal(h.db.tasks[2].fields.Agent[0],rid(2));assert.equal(h.db.tasks[2].fields.Status,'New');assert.equal(h.db.updates.length,1);});
test('status update rejects stale versions and logs completion, audit, notification',()=>{const h=harness();assert.throws(()=>h.call('secretary','status',{id:rid(11),version:'old',status:'Completed',requestId:crypto.randomUUID()}),/CONFLICT/);h.call('secretary','status',{id:rid(11),version:'v1',status:'Completed',message:'done',requestId:crypto.randomUUID()});assert.equal(h.db.tasks[0].fields.Status,'Completed');assert.ok(h.db.tasks[0].fields['Completed At']);assert.equal(h.db.updates.length,1);assert.equal(h.db.notifications[0].fields.Recipient[0],rid(2));});
test('a failed audit resumes on retry without reapplying a task status mutation',()=>{const h=harness(),upsert=h.ctx.upsert_;let fail=true;h.ctx.upsert_=(table,...args)=>{if(table==='updates'&&fail){fail=false;throw new Error('network failure');}return upsert(table,...args);};const d={id:rid(11),version:'v1',status:'In Progress',requestId:crypto.randomUUID()};assert.throws(()=>h.call('secretary','status',d),/network/);assert.throws(()=>h.call('secretary','comment',{id:rid(11),message:'different operation',requestId:crypto.randomUUID()}),/คำขอที่ยังบันทึกไม่ครบ/);h.call('secretary','status',d);assert.equal(h.calls.filter(c=>c[0]==='patch'&&c[1]==='tasks').length,1);assert.equal(h.db.updates.length,1);assert.equal(h.db.notifications.length,1);});
test('reusing the same operation key with changed payload is rejected',()=>{const h=harness();const d={id:rid(11),message:'one',requestId:crypto.randomUUID()};h.call('one','comment',d);assert.throws(()=>h.call('one','comment',{...d,message:'two'}),/ข้อมูลเปลี่ยน/);});
test('follow-up is separate from task status; resolving selects earliest pending date',()=>{const h=harness();h.call('secretary','followup',{id:rid(11),date:'2026-11-06',notes:'call',requestId:crypto.randomUUID()});h.call('secretary','followup',{id:rid(11),date:'2026-11-04',notes:'check',requestId:crypto.randomUUID()});assert.equal(h.db.tasks[0].fields.Status,'New');assert.equal(h.db.tasks[0].fields['Next Follow-up'],'2026-11-04');h.call('secretary','resolveFollowup',{id:rid(11),followupId:h.db.followups[1].id,status:'Done',notes:'called',requestId:crypto.randomUUID()});assert.equal(h.db.tasks[0].fields['Next Follow-up'],'2026-11-06');});
test('follow-up from another task cannot be resolved',()=>{const h=harness();h.db.followups.push({id:rid(50),fields:{Task:[rid(12)],'Follow-up Status':'Pending'}});assert.throws(()=>h.call('secretary','resolveFollowup',{id:rid(11),followupId:rid(50),status:'Done',notes:'x',requestId:crypto.randomUUID()}),/FORBIDDEN/);});
test('dates, record IDs, select values and unsafe reference URLs are rejected',()=>{const h=harness();assert.throws(()=>h.ctx.date_('2026-02-30',true),/วันที่/);assert.throws(()=>h.ctx.recordId_('rec1/../secret'),/รหัส/);assert.throws(()=>h.ctx.choice_('Unknown',h.ctx.APP_.statuses),/ไม่ถูกต้อง/);assert.throws(()=>h.call('one','create',{title:'x',description:'x',priority:'Normal',category:'งานทั่วไป',dueDate:'2026-11-04',referenceUrl:'javascript:alert(1)',requestId:crypto.randomUUID()}),/https/);});
test('Google login uses a one-use ticket bound to the browser verifier',()=>{const h=harness(),ticket=crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(32).toString('hex');h.cache.set('ticket:'+h.ctx.hash_(ticket),JSON.stringify({userId:rid(2),sub:'sub-one',challenge:h.ctx.hash_(verifier)}));assert.throws(()=>h.ctx.completeGoogleLogin(ticket,'0'.repeat(64)),/เบราว์เซอร์/);const session=h.ctx.completeGoogleLogin(ticket,verifier);assert.match(session.token,/^[a-f0-9]{64}$/);assert.throws(()=>h.ctx.completeGoogleLogin(ticket,verifier),/หมดอายุ/);assert.equal(h.ctx.requireUser_(session.token).id,rid(2));h.ctx.logout(session.token);assert.throws(()=>h.ctx.requireUser_(session.token),/UNAUTHENTICATED/);});
test('Google Subject binding refuses a different Google account',()=>{const h=harness();h.ctx.listAll_=()=>[clone(h.db.users[1])];assert.throws(()=>h.ctx.findIdentity_({sub:'attacker',email:'agent1@gmail.com',email_verified:true}),/ไม่ตรง/);assert.throws(()=>h.ctx.findIdentity_({sub:'sub-one',email:'agent1@gmail.com',email_verified:false}),/ยืนยัน/);});
test('all pages of Airtable records are fetched, offset is encoded and 429 waits 30 seconds',()=>{
  const h=harness();vm.runInContext(fs.readFileSync(path.join(root,'apps-script/AirtableService.gs'),'utf8'),h.ctx);
  h.properties.set('AIRTABLE_TOKEN','secret');h.properties.set('AIRTABLE_BASE_ID','app123');
  const urls=[],sleeps=[];let n=0;h.ctx.Utilities.sleep=ms=>sleeps.push(ms);
  h.ctx.UrlFetchApp.fetch=(url)=>{urls.push(url);n++;return {getResponseCode:()=>n===2?429:200,getContentText:()=>JSON.stringify(n===1?{records:[{id:'first'}],offset:'a/b+c'}:{records:[{id:'second'}]})};};
  const records=h.ctx.listAll_('tasks');assert.equal(records.length,2);assert.match(urls[1],/offset=a%2Fb%2Bc/);assert.ok(sleeps.includes(30000));
});
test('only explicitly designed RPC and guarded setup functions are exposed',()=>{const functions=[...source.matchAll(/^function (\w+)\(/gm)].map(m=>m[1]).filter(n=>!n.endsWith('_'));assert.deepEqual(functions.sort(),['api','completeGoogleLogin','doGet','logout','startGoogleLogin','startLineLink','completeLineLink','initializeProject','checkDeployment'].sort());});
test('templates escape script-breaking markup',()=>{const h=harness();assert.ok(!h.ctx.jsonForHtml_({x:'</script><script>alert(1)</script>'}).includes('<'));});
test('migration maintenance blocks every task mutation before writing while reads remain available',()=>{
  const h=harness();h.properties.set('ENABLE_TASK_WRITES','false');
  for(const action of ['create','status','comment','followup','resolveFollowup'])assert.throws(()=>h.call('secretary',action,{requestId:crypto.randomUUID()}),/MAINTENANCE/);
  assert.equal(h.calls.some(c=>['patch','upsert'].includes(c[0])),false);
  assert.equal(h.call('secretary','bootstrap').tasks.length,2);
});
test('saving Completed again preserves the original completion time for daily summaries',()=>{const h=harness(),original='2026-10-01T09:00:00Z';h.db.tasks[0].fields.Status='Completed';h.db.tasks[0].fields['Completed At']=original;h.call('secretary','status',{id:rid(11),version:'v1',status:'Completed',message:'Additional summary',requestId:crypto.randomUUID()});assert.equal(h.db.tasks[0].fields['Completed At'],original);});
