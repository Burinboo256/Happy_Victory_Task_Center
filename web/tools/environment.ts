import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readConfig } from '../src/server/config';

export function localEnvironment() {
  const filename = resolve('.env.local');
  if (existsSync(filename)) process.loadEnvFile(filename);
  return process.env;
}
export const localConfig = () => readConfig(localEnvironment());
