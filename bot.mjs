// Fluxo Contas: robô do grupo FLUXO CONTAS no WhatsApp → app de finanças (Firebase finan-xgana).
//   node bot.mjs conectar        QR para ligar o WhatsApp (aparelho conectado "Fluxo Contas", só na 1ª vez)
//   node bot.mjs grupos          lista os grupos (id e nome)
//   node bot.mjs lares           lista os "lares" do app no Firebase
//   node bot.mjs teste "<msg>"   mostra o que o robô faria com a mensagem, sem gravar nem mandar nada
//   node bot.mjs ciclo           liga, trata o que chegou no grupo, manda os avisos do horário e desliga (nuvem, a cada 5 min)
//   node bot.mjs rodar           fica ligado escutando (alternativa num PC/servidor sempre ligado)
// Configuração por variáveis de ambiente (na nuvem vêm dos Secrets) ou config.json:
//   FLUXO_GRUPO / grupo, FLUXO_LAR / lar, FLUXO_SESSAO (pasta da conexão), FLUXO_ESTADO (estado.json),
//   FLUXO_CHAVE (arquivo da chave de serviço do Firebase; padrão %USERPROFILE%\.claude\fluxo-contas-firebase.json)
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from 'baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import * as R from './contas.mjs';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const lerJson = (p, padrao) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return padrao; } };
const ARQ = lerJson(path.join(PASTA, 'config.json'), {});
const CONFIG = {
  grupo: process.env.FLUXO_GRUPO || ARQ.grupo,
  lar: process.env.FLUXO_LAR || ARQ.lar,
  meuNome: process.env.FLUXO_MEU_NOME || ARQ.meuNome || 'Vinicius',
};
const SESSAO = process.env.FLUXO_SESSAO || ARQ.sessao || path.join(PASTA, 'sessao');
const CHAVE = process.env.FLUXO_CHAVE || path.join(os.homedir(), '.claude', 'fluxo-contas-firebase.json');
const ESTADO = process.env.FLUXO_ESTADO || path.join(PASTA, 'estado.json');
const [, , comando, ...args] = process.argv;

// log público na nuvem: só o tipo do evento, nunca valores, categorias ou nomes
const log = (...m) => console.log(`[${new Date().toLocaleString('pt-BR')}]`, ...m);

// ------------------------------------------------------------------ Firebase
let _db;
async function db() {
  if (_db) return _db;
  if (!existsSync(CHAVE)) throw new Error('Falta a chave do Firebase em ' + CHAVE);
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ credential: cert(JSON.parse(readFileSync(CHAVE, 'utf8'))) });
  return (_db = getFirestore());
}
const refLar = async () => (await db()).collection('households').doc(CONFIG.lar);
async function lerLar() { return R.estadoDoLar((await (await refLar()).get()).data()); }

/** Muda o documento do lar numa transação (não atropela o que o app gravou ao mesmo tempo). */
async function mexer(fn, quem) {
  const { FieldValue } = await import('firebase-admin/firestore');
  const ref = await refLar();
  return (await db()).runTransaction(async tx => {
    const antes = R.estadoDoLar((await tx.get(ref)).data());
    const { campos, resultado } = fn(antes);
    tx.set(ref, { ...campos, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'WhatsApp · ' + quem }, { merge: true });
    return { antes, depois: { ...antes, ...campos }, resultado };
  });
}
const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7); // mesmo formato do app

// ------------------------------------------------------------------ estado local (o que já foi tratado)
const estado = Object.assign({ processadas: [], enviadas: [], ultimos: {}, pendentes: {}, avisos: {}, desde: 0 }, lerJson(ESTADO, {}));
const salvarEstado = () => {
  estado.processadas = estado.processadas.slice(-500);
  estado.enviadas = estado.enviadas.slice(-500);
  mkdirSync(path.dirname(ESTADO), { recursive: true });
  writeFileSync(ESTADO, JSON.stringify(estado));
};

// ------------------------------------------------------------------ o que fazer com cada mensagem
async function tratar(texto, quem, chaveQuem, hoje = new Date(), simular = false) {
  const st = await lerLar();
  const r = R.entender(texto, st, hoje);
  if (!r) return null;
  if (r.erro) return r.erro;
  const lancar = async lanc => {
    if (simular) return '[teste, não gravado]\n' + R.respostaLancamento(lanc, st, { ...st, entries: [...st.entries, lanc] }, hoje);
    const entrada = { id: novoId(), ...lanc, origem: 'whatsapp', por: quem };
    const { antes, depois } = await mexer(s => ({ campos: { entries: [...s.entries, entrada] } }), quem);
    (estado.ultimos[chaveQuem] ||= []).push(entrada.id);
    estado.ultimos[chaveQuem] = estado.ultimos[chaveQuem].slice(-20);
    log('lançamento gravado');
    return R.respostaLancamento(lanc, antes, depois, hoje);
  };
  if (r.lancamento) { delete estado.pendentes[chaveQuem]; return lancar(r.lancamento); }
  if (r.semCategoria) {
    estado.pendentes[chaveQuem] = r.semCategoria;
    return `Não achei a categoria "${r.palavra}". Lanço ${R.fmt(r.semCategoria.valor)} em *Outros*? Responda *sim*, ou mande de novo com a categoria certa.\n${R.listaCategorias(st)}`;
  }
  switch (r.cmd) {
    case 'ajuda': return R.ajuda(st);
    case 'resumo': return R.resumo(st, hoje);
    case 'faltam': return R.faltam(st, hoje);
    case 'consulta': return R.consulta(st, r.categoria, hoje);
    case 'orcamentos': return R.orcamentos(st, hoje);
    case 'orcamento': case 'nova': {
      if (simular) return '[teste, não gravado] ' + JSON.stringify(r);
      const { antes, depois } = await mexer(s => ({
        campos: { categorias: r.cmd === 'nova' ? [...s.categorias, r.categoria] : s.categorias.map(c => c.nome === r.categoria ? { ...c, orcamento: r.valor } : c) },
      }), quem);
      log('categoria alterada');
      if (r.cmd === 'nova') return `🆕 Categoria *${r.categoria.nome}* criada · orçamento ${R.fmt(r.categoria.orcamento)}${r.categoria.mensal ? ' · conta fixa do mês' : ''}`;
      const antigo = (antes.categorias.find(c => c.nome === r.categoria) || {}).orcamento || 0;
      return `✏️ Orçamento de *${r.categoria}*: ${R.fmt(antigo)} → *${R.fmt(r.valor)}*\n` + R.consulta(depois, r.categoria, hoje);
    }
    case 'sim': {
      const p = estado.pendentes[chaveQuem];
      if (!p) return null;
      delete estado.pendentes[chaveQuem];
      return lancar(p);
    }
    case 'nao': return estado.pendentes[chaveQuem] ? (delete estado.pendentes[chaveQuem], '👍 Não lancei.') : null;
    case 'desfazer': {
      const id = (estado.ultimos[chaveQuem] || []).at(-1);
      if (!id) return 'Não tem lançamento seu feito por aqui para desfazer.';
      if (simular) return '[teste] apagaria o lançamento ' + id;
      const { resultado } = await mexer(s => {
        const i = s.entries.findIndex(x => x.id === id);
        return { campos: { entries: i < 0 ? s.entries : s.entries.filter((_, k) => k !== i) }, resultado: i < 0 ? null : s.entries[i] };
      }, quem);
      estado.ultimos[chaveQuem].pop();
      if (!resultado) return 'Esse lançamento já tinha sido apagado no app.';
      log('lançamento desfeito');
      return `↩️ Apaguei: *${resultado.categoria}* ${R.fmt(resultado.valor)} · ${resultado.data.slice(8, 10)}/${resultado.data.slice(5, 7)}`;
    }
  }
  return null;
}

// ------------------------------------------------------------------ WhatsApp
function conectar() {
  return new Promise(async (resolve, reject) => {
    const { state, saveCreds } = await useMultiFileAuthState(SESSAO);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      auth: state, version, logger: pino({ level: 'silent' }),
      browser: Browsers.windows('Fluxo Contas'),
      markOnlineOnConnect: false, syncFullHistory: false,
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        if (comando !== 'conectar') return reject(new Error("WhatsApp desconectado: rode 'node bot.mjs conectar' de novo"));
        const png = path.join(PASTA, 'qr.png');
        await QRCode.toFile(png, qr, { width: 400 });
        console.log('Escaneie o QR: WhatsApp > Aparelhos conectados > Conectar aparelho. Arquivo:', png);
        if (process.platform === 'win32') exec(`start "" "${png}"`);
      }
      if (connection === 'open') resolve(sock);
      if (connection === 'close') {
        const codigo = lastDisconnect?.error?.output?.statusCode;
        if (codigo === DisconnectReason.restartRequired) return resolve(conectar());
        if (codigo === DisconnectReason.loggedOut) {
          rmSync(SESSAO, { recursive: true, force: true });
          return reject(new Error("O aparelho foi desconectado no celular: rode 'node bot.mjs conectar' de novo"));
        }
        reject(lastDisconnect?.error || new Error('Conexão fechada'));
      }
    });
  });
}

// as respostas saem do número do usuário (fromMe): este caractere invisível no começo marca "foi o robô", para ele não ler a própria resposta
const MARCA = '⁣';
const textoDe = m => {
  const msg = m.message?.ephemeralMessage?.message || m.message || {};
  return msg.conversation || msg.extendedTextMessage?.text || '';
};

async function mandar(sock, texto, citar) {
  const r = await sock.sendMessage(CONFIG.grupo, { text: MARCA + texto }, citar ? { quoted: citar } : {});
  if (r?.key?.id) { estado.enviadas.push(r.key.id); salvarEstado(); }
}

/** Liga o tratamento das mensagens do grupo. Devolve uma função que espera terminar o que está em andamento. */
function escutar(sock) {
  let fila = Promise.resolve();
  const aoChegar = ({ messages }) => {
    for (const m of messages) fila = fila.then(() => umaMensagem(sock, m)); // uma por vez, na ordem
  };
  sock.ev.on('messages.upsert', aoChegar);
  return () => fila;
}

async function umaMensagem(sock, m) {
  try {
    const id = m.key?.id, ts = Number(m.messageTimestamp || 0);
    if (m.key?.remoteJid !== CONFIG.grupo || !id) return;
    if (estado.processadas.includes(id) || estado.enviadas.includes(id)) return;
    if (ts < estado.desde || ts < Date.now() / 1000 - 3 * 86400) return; // só mensagens novas (até 3 dias)
    const bruto = textoDe(m);
    if (bruto.startsWith(MARCA)) return;
    estado.processadas.push(id); salvarEstado();
    const texto = bruto.trim();
    if (!texto) return;
    const quem = m.key.fromMe ? CONFIG.meuNome : (m.pushName || 'alguém');
    const chaveQuem = m.key.fromMe ? 'eu' : (m.key.participant || m.participant || quem);
    log('mensagem do grupo recebida');
    const resp = await tratar(texto, quem, chaveQuem, ts ? new Date(ts * 1000) : new Date());
    salvarEstado();
    if (resp) await mandar(sock, resp, m);
  } catch (e) {
    log('ERRO ao tratar mensagem:', e.message);
    try { await mandar(sock, '⚠️ Deu erro ao processar essa mensagem. Nada foi lançado. Tente de novo em instantes.', m); } catch {}
  }
}

async function agendados(sock) {
  // segunda 8h: resumo da semana + contas fixas; dia 1 8h: fechamento do mês. Manda na 1ª rodada a partir das 8h do dia.
  const agora = new Date(), hoje = R.isoLocal(agora);
  if (agora.getHours() < 8) return;
  if (agora.getDate() === 1 && estado.avisos.mes !== hoje) {
    await mandar(sock, R.fechamentoMensal(await lerLar(), agora));
    estado.avisos.mes = hoje; salvarEstado(); log('fechamento do mês enviado');
  }
  if (agora.getDay() === 1 && estado.avisos.semana !== hoje) {
    await mandar(sock, R.resumoSemanal(await lerLar(), agora));
    estado.avisos.semana = hoje; salvarEstado(); log('resumo semanal enviado');
  }
}

function conferirConfig() {
  if (!CONFIG.grupo || !CONFIG.lar) throw new Error('faltam o grupo e o lar (FLUXO_GRUPO/FLUXO_LAR ou config.json)');
  if (!estado.desde) { estado.desde = Math.floor(Date.now() / 1000); salvarEstado(); } // não trata o histórico antigo do grupo
}

/** Nuvem: conecta, recebe o que ficou guardado no WhatsApp desde a última rodada, responde, manda os avisos e sai. */
async function ciclo() {
  conferirConfig();
  await db();
  const sock = await conectar();
  const terminar = escutar(sock);
  // o WhatsApp avisa quando terminou de entregar as mensagens guardadas (receivedPendingNotifications);
  // depois disso espera mais uns segundos sem novidade. Teto de 3 min por rodada.
  let ultima = Date.now(), entregue = false;
  sock.ev.on('messages.upsert', () => { ultima = Date.now(); });
  sock.ev.on('connection.update', u => { if (u.receivedPendingNotifications) entregue = true; });
  const inicio = Date.now();
  while (Date.now() - inicio < 180_000) {
    await new Promise(r => setTimeout(r, 1000));
    if (entregue && Date.now() - ultima > 8000) break;
    if (!entregue && Date.now() - inicio > 60_000 && Date.now() - ultima > 15_000) break;
  }
  await terminar();
  await agendados(sock).catch(e => log('ERRO nos avisos:', e.message));
  await new Promise(r => setTimeout(r, 3000)); // dá tempo de as mensagens saírem
  sock.end(undefined);
  log('rodada ok');
}

/** PC ou servidor sempre ligado: fica escutando e reconecta se cair. */
async function rodar() {
  conferirConfig();
  await db();
  for (;;) {
    let timer;
    try {
      const sock = await conectar();
      log('conectado; escutando o grupo');
      escutar(sock);
      timer = setInterval(() => agendados(sock).catch(e => log('ERRO nos avisos:', e.message)), 60_000);
      await new Promise((_, rej) => sock.ev.on('connection.update', u => { if (u.connection === 'close') rej(u.lastDisconnect?.error || new Error('fechou')); }));
    } catch (e) {
      clearInterval(timer);
      if (/desconectado no celular/.test(e.message)) throw e;
      log('conexão caiu:', e.message, '→ tento de novo em 30 s');
      await new Promise(r => setTimeout(r, 30_000));
    }
  }
}

try {
  if (comando === 'teste') {
    console.log((await tratar(args.join(' '), 'teste', 'teste', new Date(), true)) ?? '(o robô não responderia)');
  } else if (comando === 'lares') {
    const snap = await (await db()).collection('households').get();
    snap.forEach(d => { const x = d.data(); console.log(d.id, '·', x.name || '', '·', (x.entries || []).length, 'lançamentos'); });
  } else if (comando === 'conectar' || comando === 'grupos') {
    const sock = await conectar();
    if (comando === 'grupos') {
      const g = await sock.groupFetchAllParticipating();
      Object.values(g).sort((a, b) => a.subject.localeCompare(b.subject)).forEach(x => console.log(x.id, '·', x.subject));
    } else console.log('Conectado.');
    await new Promise(r => setTimeout(r, 5000)); sock.end(undefined);
  } else if (comando === 'ciclo') {
    await ciclo();
  } else if (comando === 'rodar') {
    await rodar();
  } else {
    console.log('Uso: node bot.mjs conectar | grupos | lares | teste "<mensagem>" | ciclo | rodar');
    process.exit(1);
  }
  process.exit(0);
} catch (e) {
  log('ERRO:', e.message);
  process.exit(2);
}
