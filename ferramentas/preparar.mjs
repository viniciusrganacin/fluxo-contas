// Prepara a 1ª rodada da nuvem: liga um aparelho conectado novo ("Fluxo Contas") só para a nuvem e
// guarda a conexão criptografada em estado-inicial.enc (vai para o GitHub; só abre com CHAVE_ESTADO).
// Rodar pelo usuário, uma vez (ou de novo se o aparelho for desconectado no celular):
//   node ferramentas/preparar.mjs
// A chave fica em %USERPROFILE%\.claude\fluxo-contas-nuvem.json. A cópia aberta da conexão é apagada no fim:
// a mesma conexão usada em dois lugares se derruba.
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASA = path.join(os.homedir(), '.claude');
const CFG = path.join(CASA, 'fluxo-contas-nuvem.json');
const TMP = path.join(CASA, 'fluxo-contas-preparo');

const cfg = existsSync(CFG) ? JSON.parse(readFileSync(CFG, 'utf8')) : {};
if (!cfg.chave_estado) {
  cfg.chave_estado = execFileSync('node', [path.join(RAIZ, 'ferramentas', 'cripto.cjs'), 'nova-chave']).toString().trim();
  writeFileSync(CFG, JSON.stringify(cfg, null, 1));
  console.log('chave nova criada em', CFG);
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
try {
  console.log('Abrindo o QR. No celular: WhatsApp > Aparelhos conectados > Conectar aparelho.');
  const r = spawnSync('node', ['bot.mjs', 'conectar'], { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, FLUXO_SESSAO: path.join(TMP, 'sessao') } });
  if (r.status !== 0 || !existsSync(path.join(TMP, 'sessao', 'creds.json'))) throw new Error('não conectou');
  // a nuvem só trata mensagens a partir de agora
  writeFileSync(path.join(TMP, 'estado.json'), JSON.stringify({ desde: Math.floor(Date.now() / 1000) }));
  const tgz = path.join(CASA, 'fluxo-contas-estado.tgz');
  // caminhos relativos: o tar do Git Bash entende "C:\..." como outro computador
  execFileSync('tar', ['czf', path.basename(tgz), '-C', path.basename(TMP), '.'], { cwd: CASA });
  execFileSync('node', [path.join(RAIZ, 'ferramentas', 'cripto.cjs'), 'cifrar', 'CHAVE_ESTADO', tgz, path.join(RAIZ, 'estado-inicial.enc')],
    { env: { ...process.env, CHAVE_ESTADO: cfg.chave_estado } });
  rmSync(tgz, { force: true });
  console.log('Pronto: estado-inicial.enc criado. Falta enviar para o GitHub.');
} finally {
  rmSync(TMP, { recursive: true, force: true });
}
