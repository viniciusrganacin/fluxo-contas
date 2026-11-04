// Grava os Secrets do projeto no GitHub (conta pessoal), sem mostrar nada na tela:
//   node ferramentas/gravar_segredos.mjs
// Lê de %USERPROFILE%\.claude: fluxo-contas-nuvem.json (chave_estado, usuario) e fluxo-contas-firebase.json;
// grupo e lar vêm do config.json desta pasta.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASA = path.join(os.homedir(), '.claude');
const GH = path.join(os.homedir(), '.local', 'gh', 'bin', 'gh.exe');
const cfg = JSON.parse(readFileSync(path.join(CASA, 'fluxo-contas-nuvem.json'), 'utf8'));
const local = JSON.parse(readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
if (!cfg.usuario) throw new Error('falta "usuario" (conta pessoal do GitHub) em fluxo-contas-nuvem.json');
const projeto = `${cfg.usuario}/fluxo-contas`;
// usa o login da conta pessoal só nestes comandos, sem trocar a conta ativa do gh (a do trabalho)
const env = { ...process.env, GH_TOKEN: execFileSync(GH, ['auth', 'token', '-u', cfg.usuario]).toString().trim() };

const segredos = {
  CHAVE_ESTADO: cfg.chave_estado,
  FIREBASE_KEY: readFileSync(path.join(CASA, 'fluxo-contas-firebase.json'), 'utf8'),
  FLUXO_GRUPO: local.grupo,
  FLUXO_LAR: local.lar,
};
for (const [nome, valor] of Object.entries(segredos)) execFileSync(GH, ['secret', 'set', nome, '-R', projeto], { input: valor, env });
console.log(execFileSync(GH, ['secret', 'list', '-R', projeto], { env }).toString());
