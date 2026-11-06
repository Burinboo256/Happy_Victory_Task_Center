import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
await import('../tools/build-preview.mjs');
test('preview contains its adapter before app initialization and no unresolved Apps Script template',async()=>{
  const html=await fs.readFile(path.join(root,'dist/index.html'),'utf8');
  assert.ok(html.indexOf('window.HVR_DEMO=')>0);
  assert.ok(html.indexOf('window.HVR_DEMO=')<html.indexOf("'use strict';"));
  assert.ok(!html.includes('<?'));
  assert.ok(html.includes('"demo":true'));
});
test('production template contains no demo adapter or simulated identity',async()=>{
  const index=await fs.readFile(path.join(root,'apps-script/Index.html'),'utf8');
  assert.ok(!index.includes('Demo'));
  const backend=await fs.readFile(path.join(root,'apps-script/Code.gs'),'utf8');
  assert.match(backend,/demo: false/);
});
test('demo bootstrap, create, status and comment enforce role and update task state',async()=>{
  const raw=await fs.readFile(path.join(root,'preview/Demo.html'),'utf8'),storage=new Map();
  const context=vm.createContext({window:{},Date,Intl,crypto,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
  vm.runInContext(raw.replace(/^<script>/,'').replace(/<\/script>\s*$/,''),context);
  const demo=context.window.HVR_DEMO;
  const secretary=await demo.api('bootstrap');assert.equal(secretary.tasks.length,16);
  const agent=demo.users().find(u=>u.role==='Agent');demo.setUser(agent.id);
  const own=await demo.api('bootstrap');assert.ok(own.tasks.every(t=>t.agentId===agent.id));
  const detail=await demo.api('detail',{id:own.tasks[0].id});assert.ok(detail.updates.every(u=>u.visible));
  await assert.rejects(demo.api('status',{id:own.tasks[0].id,status:'Completed',requestId:crypto.randomUUID()}),/FORBIDDEN/);
  const created=await demo.api('create',{title:'<title> & test',description:'test',dueDate:own.today,priority:'Normal',category:'งานทั่วไป',requestId:crypto.randomUUID()});
  const saved=await demo.api('detail',created);assert.equal(saved.task.agentId,agent.id);assert.equal(saved.task.status,'New');
  demo.setUser(secretary.user.id);
  await demo.api('status',{id:created.id,version:saved.task.version,status:'Completed',requestId:crypto.randomUUID()});
  assert.equal((await demo.api('detail',created)).task.status,'Completed');
});
