import fs from 'node:fs/promises';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

// Parse Google's public HTML transport without evaluating downloaded JavaScript.
export function checkDeploymentResponse(response) {
  const match = response.match(/goog\.script\.init\("((?:\\.|[^"\\])*)"/);
  if (!match) throw new Error('Missing Apps Script HTML payload.');
  const literal = match[1].replace(/\\(?:x([0-9a-f]{2})|'|.)/gi, (sequence, hex) => {
    if (hex) return '\\u00' + hex;
    return sequence === "\\'" ? "'" : sequence;
  });
  const config = JSON.parse(JSON.parse('"' + literal + '"'));
  if (typeof config.userHtml !== 'string') throw new Error('Missing userHtml.');
  const scripts = [...config.userHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  if (scripts.length < 2) throw new Error('Missing production boot or application script.');
  for (const [index, script] of scripts.entries()) new vm.Script(script[1], { filename: 'deployed-script-' + index + '.js' });
  if (config.userHtml.includes('window.HVR_DEMO=') || /"demo"\s*:\s*true/.test(config.userHtml)) throw new Error('Demo must not be deployed.');
  return { inlineScripts: scripts.length, htmlCharacters: config.userHtml.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: node tools/check-deployment.mjs <downloaded-response.html>');
  const result = checkDeploymentResponse(await fs.readFile(process.argv[2], 'utf8'));
  console.log('Deployed HTML scripts parse: ' + JSON.stringify(result));
}
