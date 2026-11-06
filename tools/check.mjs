import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
for(const name of await fs.readdir(path.join(root,'apps-script'))){
  const text=await fs.readFile(path.join(root,'apps-script',name),'utf8');
  if(name.endsWith('.gs'))new vm.Script(text,{filename:name});
  if(name.endsWith('.html'))for(const m of text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))if(!m[1].includes('<?'))new vm.Script(m[1],{filename:name});
}
JSON.parse(await fs.readFile(path.join(root,'apps-script/appsscript.json'),'utf8'));
const demo=await fs.readFile(path.join(root,'preview/Demo.html'),'utf8');new vm.Script(demo.replace(/^<script>/,'').replace(/<\/script>\s*$/,''));
console.log('All Apps Script, frontend and demo JavaScript parsed; manifest valid.');
