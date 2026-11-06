import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDeploymentResponse } from '../tools/check-deployment.mjs';

function response(html) {
  const literal = JSON.stringify(JSON.stringify({ userHtml: html })).replaceAll('{', '\\x7b').replaceAll('<', '\\x3c');
  return 'goog.script.init(' + literal + ');';
}
const boot = '<script>window.HVR_BOOT={"demo":false};</script>';
test('deployment check parses Google hex-escaped transport and preserves literal backslashes', () => {
  const html = boot + '<script>const value="\\\\x41";</script>';
  assert.equal(checkDeploymentResponse(response(html)).htmlCharacters, html.length);
});
test('deployment check catches the truncated template literal that leaves Login on its loader', () => {
  assert.throws(() => checkDeploymentResponse(response(boot + '<script>const form=`<input pattern="https:\nconst next=1;</script>')), SyntaxError);
});
test('deployment check rejects missing app scripts and simulated identities', () => {
  assert.throws(() => checkDeploymentResponse('<html>Sign in</html>'), /Missing Apps Script/);
  assert.throws(() => checkDeploymentResponse(response(boot)), /Missing production/);
  assert.throws(() => checkDeploymentResponse(response(boot + '<script>window.HVR_DEMO={};window.HVR_DEMO=1;</script>')), /Demo/);
});
