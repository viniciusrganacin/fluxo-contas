// Regras do Fluxo Contas: entende a mensagem do grupo e monta as respostas.
// Mesmas contas do app (splendorous-kitten-5b6663.netlify.app): receita "real" exclui Rendimentos,
// categoria com poupanca=true é o "Guardar", orçamento por categoria, dias restantes = último dia − hoje.

export const FONTES = ['Salário', 'Esposa', 'Renda extra', 'Outros', 'Rendimentos'];
export const META_GUARDAR = 500;
const CATEGORIAS_PADRAO = [ // as mesmas do app, para quando o lar ainda não tem categorias salvas
  ['Aluguel', true, 1300, 'fixa'], ['Internet', true, 129.9, 'fixa'], ['Banho Sanji', true, 100, 'fixa'], ['Ração', true, 80, 'fixa'],
  ['Fono', true, 160, 'fixa'], ['Manu', true, 250, 'fixa'], ['Natan', true, 405.55, 'fixa'], ['Blablacar', true, 250, 'fixa'],
  ['Guardar', true, 500, 'fixa', true], ['Disney Plus', true, 19.9, 'fixa'], ['Gasolina', false, 400, 'variavel'],
  ['Mercado', false, 1500, 'variavel'], ['Farmácia', false, 400, 'variavel'], ['Saídas', false, 500, 'variavel'],
  ['Luz', true, 400, 'variavel'], ['Condomínio', true, 260, 'variavel'], ['Fifa Stats', false, 200, 'excecao'],
  ['Cabelo', false, 180, 'excecao'], ['Outros', false, 0, 'excecao'],
].map(([nome, mensal, orcamento, classe, poupanca]) => ({ nome, mensal, orcamento, classe, poupanca: !!poupanca }));

export const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const fmt = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = v => Math.round(v) + '%';
const dd = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
export const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = ym => MESES[Number(ym.slice(5, 7)) - 1];
export const shiftYM = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1); return isoLocal(d).slice(0, 7); };

export function estadoDoLar(d) {
  return {
    entries: (d && d.entries) || [],
    categorias: d && d.categorias && d.categorias.length
      ? d.categorias.map(c => ({ nome: c.nome, mensal: !!c.mensal, orcamento: Number(c.orcamento) || 0, classe: c.classe || 'variavel', poupanca: c.poupanca === true }))
      : CATEGORIAS_PADRAO,
  };
}

// ------------------------------------------------------------------ entender a mensagem
const RE_DATA = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/;
const RE_VALOR = /^(?:r\$)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)$/i;

function lerValor(t) {
  const m = t.replace(/^r\$/i, '').match(/^[\d.,]+$/) && t.replace(/^r\$/i, '');
  if (!m) return null;
  const v = m.includes(',') ? Number(m.replace(/\./g, '').replace(',', '.')) : (/^\d{1,3}(\.\d{3})+$/.test(m) ? Number(m.replace(/\./g, '')) : Number(m));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

function lerData(t, hoje) {
  const n = norm(t);
  const menos = k => { const d = new Date(hoje); d.setDate(d.getDate() - k); return isoLocal(d); };
  if (n === 'hoje') return isoLocal(hoje);
  if (n === 'ontem') return menos(1);
  if (n === 'anteontem') return menos(2);
  const m = n.match(RE_DATA);
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]);
  let ano = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : hoje.getFullYear();
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  let d = new Date(ano, mes - 1, dia);
  if (d.getMonth() !== mes - 1) return null;
  if (!m[3] && (d - hoje) / 864e5 > 60) d = new Date(ano - 1, mes - 1, dia); // "28/12" mandado em janeiro = ano passado
  return isoLocal(d);
}

function acharCategoria(palavras, nomes) {
  // tenta as 3, 2 e 1 primeiras palavras; aceita igual, plural ("saida" ~ "Saídas") e começo único ("merc" → Mercado)
  for (let k = Math.min(3, palavras.length); k >= 1; k--) {
    const frase = norm(palavras.slice(0, k).join(' '));
    const sem_s = s => s.replace(/s$/, '');
    let achou = nomes.find(n => norm(n) === frase) || nomes.find(n => sem_s(norm(n)) === sem_s(frase));
    if (!achou && frase.length >= 3) {
      const comeco = nomes.filter(n => norm(n).startsWith(frase));
      if (comeco.length === 1) achou = comeco[0];
    }
    if (achou) return { nome: achou, usadas: k };
  }
  return null;
}

/** Devolve {cmd:...} ou {lancamento:{tipo,data,categoria,descricao,valor}} ou {semCategoria:{...}} ou {erro}. */
export function entender(texto, estado, hoje = new Date()) {
  const bruto = (texto || '').trim().replace(/\s+/g, ' ');
  const n = norm(bruto);
  if (!n) return null;
  if (['ajuda', 'help', 'comandos', '?'].includes(n)) return { cmd: 'ajuda' };
  if (['resumo', 'saldo', 'mes', 'resumo do mes'].includes(n)) return { cmd: 'resumo' };
  if (['faltam', 'falta', 'fixas', 'contas fixas'].includes(n)) return { cmd: 'faltam' };
  if (['desfazer', 'apagar', 'apaga', 'cancelar', 'cancela', 'desfaz'].includes(n)) return { cmd: 'desfazer' };
  if (['sim', 's', 'pode', 'ok'].includes(n)) return { cmd: 'sim' };
  if (['nao', 'n', 'não'].includes(n)) return { cmd: 'nao' };
  if (['orcamentos', 'categorias', 'orcamento'].includes(n)) return { cmd: 'orcamentos' };
  // "orçamento mercado 1800" → muda o orçamento; "nova academia 99,90 fixa" → cria categoria
  let m = n.match(/^orcamento\s+(.+?)\s+(r\$\s*)?([\d.,]+)$/);
  if (m) {
    const c = acharCategoria(m[1].split(' '), estado.categorias.map(c => c.nome));
    const v = lerValor(m[3]) ?? (/^0+([.,]0+)?$/.test(m[3]) ? 0 : null);
    if (v === null) return { erro: 'Não entendi o valor. Exemplo: *orçamento mercado 1800*' };
    return c ? { cmd: 'orcamento', categoria: c.nome, valor: v } : { erro: `Não achei a categoria "${m[1]}". Para criar: *nova ${m[1]} ${m[3]}*` };
  }
  m = bruto.match(/^nova\s+(.+?)\s+(?:r\$\s*)?([\d.,]+)(\s+fixa)?$/i);
  if (m) {
    const nome = m[1].trim().replace(/^categoria\s+/i, '');
    const v = lerValor(m[2]);
    if (v === null) return { erro: 'Não entendi o valor. Exemplo: *nova academia 99,90 fixa*' };
    if (estado.categorias.some(c => norm(c.nome) === norm(nome))) return { erro: `A categoria *${nome}* já existe. Para mudar o valor: *orçamento ${nome} ${m[2]}*` };
    const fixa = !!m[3];
    return { cmd: 'nova', categoria: { nome: nome.charAt(0).toUpperCase() + nome.slice(1), mensal: fixa, orcamento: v, classe: fixa ? 'fixa' : 'variavel', poupanca: false } };
  }
  if (n.endsWith('?')) {
    const c = acharCategoria(n.slice(0, -1).trim().split(' '), estado.categorias.map(c => c.nome));
    return c ? { cmd: 'consulta', categoria: c.nome } : { erro: `Não achei a categoria "${bruto.slice(0, -1).trim()}".\n${listaCategorias(estado)}` };
  }

  let resto = bruto, tipo = 'despesa';
  if (resto.startsWith('+')) { tipo = 'receita'; resto = resto.slice(1).trim(); }
  const toks = resto.split(' ');
  let valor = null, iValor = -1, data = null;
  const livres = []; // [palavra, antesDoValor]
  toks.forEach((t, i) => {
    if (norm(t) === 'r$') return;
    const d = lerData(t, hoje);
    if (d && !data) { data = d; return; }
    if (valor === null && RE_VALOR.test(t.replace(/^r\$/i, '')) ) { valor = lerValor(t); iValor = i; if (valor !== null) return; }
    livres.push([t, iValor < 0]);
  });
  if (valor === null) return { erro: 'Não entendi 🤔 Faltou o valor. Exemplo: *mercado 150,90*\nMande *ajuda* para ver os comandos.' };
  data = data || isoLocal(hoje);

  const antes = livres.filter(x => x[1]).map(x => x[0]), depois = livres.filter(x => !x[1]).map(x => x[0]);
  const nomes = tipo === 'receita' ? FONTES : estado.categorias.map(c => c.nome);
  let base = antes.length ? antes : depois, outras = antes.length ? depois : [];
  const cat = acharCategoria(base, nomes);
  if (!cat) {
    const lanc = { tipo, data, categoria: 'Outros', descricao: [...base, ...outras].join(' '), valor };
    return { semCategoria: lanc, palavra: base.slice(0, 2).join(' ') || '(sem nome)' };
  }
  const descricao = [...base.slice(cat.usadas), ...outras].join(' ');
  return { lancamento: { tipo, data, categoria: cat.nome, descricao, valor } };
}

// ------------------------------------------------------------------ contas (iguais às do app)
const soma = a => a.reduce((s, e) => s + (Number(e.valor) || 0), 0);
const doMes = (st, ym, tipo) => st.entries.filter(e => (e.data || '').slice(0, 7) === ym && (!tipo || e.tipo === tipo));
const gastoCat = (st, ym, nome) => soma(doMes(st, ym, 'despesa').filter(e => e.categoria === nome));
const ehRendimento = nome => norm(nome) === 'rendimentos';
const receitaReal = (st, ym) => soma(doMes(st, ym, 'receita').filter(e => !ehRendimento(e.categoria)));
const guardado = (st, ym) => soma(doMes(st, ym, 'despesa').filter(e => (st.categorias.find(c => c.nome === e.categoria) || {}).poupanca));
function diasRestantes(hoje) { return new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate() - hoje.getDate(); }

function linhaOrcamento(st, nome, hoje, ym) {
  const c = st.categorias.find(x => x.nome === nome) || { orcamento: 0 };
  const gasto = gastoCat(st, ym, nome);
  if (!(c.orcamento > 0)) return `No mês: ${fmt(gasto)} (sem orçamento)`;
  const resta = c.orcamento - gasto;
  if (resta < 0) return `No mês: ${fmt(gasto)} de ${fmt(c.orcamento)} · 🚨 estourou ${fmt(-resta)}`;
  if (resta === 0) return `No mês: ${fmt(gasto)} de ${fmt(c.orcamento)} · usou o orçamento todo`;
  const dr = ym === isoLocal(hoje).slice(0, 7) ? diasRestantes(hoje) : 0;
  return `No mês: ${fmt(gasto)} de ${fmt(c.orcamento)} · ainda tem *${pct(resta / c.orcamento * 100)}* (${fmt(resta)})` +
    (dr > 0 ? ` · ${fmt(resta / dr)}/dia` : '');
}

/** Resposta depois de lançar. `antes` = estado sem o lançamento novo (para saber se cruzou 80% / 100%). */
export function respostaLancamento(lanc, antes, depois, hoje = new Date()) {
  const ym = lanc.data.slice(0, 7);
  const desc = lanc.descricao ? ` · ${lanc.descricao}` : '';
  if (lanc.tipo === 'receita') {
    const rec = receitaReal(depois, ym), desp = soma(doMes(depois, ym, 'despesa'));
    return `✅ Receita *${lanc.categoria}* ${fmt(lanc.valor)} · ${dd(lanc.data)}${desc}\nReceitas de ${nomeMes(ym)}: ${fmt(rec)} · saldo ${fmt(rec - desp)}`;
  }
  let msg = `✅ *${lanc.categoria}* ${fmt(lanc.valor)} · ${dd(lanc.data)}${desc}\n${linhaOrcamento(depois, lanc.categoria, hoje, ym)}`;
  const c = depois.categorias.find(x => x.nome === lanc.categoria);
  if (c && c.orcamento > 0) {
    const p0 = gastoCat(antes, ym, c.nome) / c.orcamento * 100, p1 = gastoCat(depois, ym, c.nome) / c.orcamento * 100;
    if (p0 < 100 && p1 >= 100) msg += `\n🚨 *${c.nome}* passou do orçamento de ${nomeMes(ym)}.`;
    else if (p0 < 80 && p1 >= 80) msg += `\n⚠️ *${c.nome}* já usou ${pct(p1)} do orçamento de ${nomeMes(ym)}.`;
  }
  if (c && c.poupanca) msg += `\n💰 Guardado em ${nomeMes(ym)}: ${fmt(guardado(depois, ym))} (meta ${fmt(META_GUARDAR)})`;
  return msg;
}

export function consulta(st, nome, hoje = new Date()) {
  const ym = isoLocal(hoje).slice(0, 7);
  const c = st.categorias.find(x => x.nome === nome);
  let msg = `📂 *${nome}* em ${nomeMes(ym)}\n${linhaOrcamento(st, nome, hoje, ym)}`;
  const gasto = gastoCat(st, ym, nome), dr = diasRestantes(hoje), total = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  if (c && c.orcamento > 0 && gasto > 0 && dr > 0 && total - dr > 0) {
    const proj = gasto + gasto / (total - dr) * dr;
    if (proj - c.orcamento > 50) msg += `\n⚠️ Nesse ritmo, fecha o mês em ${fmt(proj)}`;
    else if (proj - c.orcamento < -50) msg += `\n👍 Nesse ritmo, fecha o mês em ${fmt(proj)}`;
  }
  const ult = doMes(st, ym, 'despesa').filter(e => e.categoria === nome).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 5);
  if (ult.length) msg += '\nÚltimos: ' + ult.map(e => `${dd(e.data)} ${fmt(e.valor)}`).join(' · ');
  return msg;
}

function blocoCategorias(st, ym, so_com_gasto = true) {
  return st.categorias
    .map(c => ({ c, g: gastoCat(st, ym, c.nome) }))
    .filter(x => !so_com_gasto || x.g > 0)
    .sort((a, b) => (b.c.orcamento > 0 ? b.g / b.c.orcamento : 0) - (a.c.orcamento > 0 ? a.g / a.c.orcamento : 0) || b.g - a.g)
    .map(({ c, g }) => {
      if (!(c.orcamento > 0)) return `• ${c.nome}: ${fmt(g)}`;
      const p = g / c.orcamento * 100;
      return `${p >= 100 ? '🚨' : p >= 80 ? '⚠️' : '•'} ${c.nome}: ${fmt(g)} de ${fmt(c.orcamento)} (${pct(p)})`;
    });
}

export function resumo(st, hoje = new Date()) {
  const ym = isoLocal(hoje).slice(0, 7);
  const rec = receitaReal(st, ym), desp = soma(doMes(st, ym, 'despesa'));
  const cats = blocoCategorias(st, ym);
  return `📊 *Resumo de ${nomeMes(ym)}* (até ${dd(isoLocal(hoje))})\n` +
    `Receitas: ${fmt(rec)}\nDespesas: ${fmt(desp)}\nSaldo: *${fmt(rec - desp)}*\n` +
    `💰 Guardado: ${fmt(guardado(st, ym))} (meta ${fmt(META_GUARDAR)})` +
    (cats.length ? `\n\n${cats.join('\n')}` : '\n\nNenhum gasto lançado ainda.');
}

export function faltam(st, hoje = new Date()) {
  const ym = isoLocal(hoje).slice(0, 7);
  const f = st.categorias.filter(c => c.mensal && gastoCat(st, ym, c.nome) === 0);
  if (!f.length) return `✅ Todas as contas fixas de ${nomeMes(ym)} já foram lançadas.`;
  return `📌 *Contas fixas de ${nomeMes(ym)} ainda não lançadas*\n` + f.map(c => `• ${c.nome}${c.orcamento > 0 ? ' (' + fmt(c.orcamento) + ')' : ''}`).join('\n');
}

export function resumoSemanal(st, hoje = new Date()) {
  // segunda 8h: semana anterior (segunda a domingo) + como está o mês + contas fixas que faltam
  const fim = new Date(hoje); fim.setDate(fim.getDate() - 1);
  const ini = new Date(hoje); ini.setDate(ini.getDate() - 7);
  const [a, b] = [isoLocal(ini), isoLocal(fim)];
  const sem = st.entries.filter(e => e.tipo === 'despesa' && e.data >= a && e.data <= b);
  const porCat = {};
  sem.forEach(e => { porCat[e.categoria] = (porCat[e.categoria] || 0) + Number(e.valor || 0); });
  const top = Object.entries(porCat).sort((x, y) => y[1] - x[1]).map(([c, v]) => `• ${c}: ${fmt(v)}`);
  let msg = `🗓️ *Semana de ${dd(a)} a ${dd(b)}*\nGastos: *${fmt(soma(sem))}* em ${sem.length} lançamento${sem.length === 1 ? '' : 's'}` +
    (top.length ? '\n' + top.join('\n') : '');
  if (hoje.getDate() > 1) msg += '\n\n' + resumo(st, fim.getMonth() === hoje.getMonth() ? fim : hoje);
  msg += '\n\n' + faltam(st, hoje);
  return msg;
}

export function fechamentoMensal(st, hoje = new Date()) {
  // dia 1 às 8h: fecha o mês anterior
  const ym = shiftYM(isoLocal(hoje).slice(0, 7), -1), ant = shiftYM(ym, -1);
  const rec = receitaReal(st, ym), desp = soma(doMes(st, ym, 'despesa'));
  const recA = receitaReal(st, ant), despA = soma(doMes(st, ant, 'despesa'));
  const g = guardado(st, ym);
  const var_ = (x, y) => y > 0 ? ` (${x >= y ? '+' : ''}${pct((x - y) / y * 100)} vs ${nomeMes(ant)})` : '';
  const estouradas = st.categorias.filter(c => c.orcamento > 0 && gastoCat(st, ym, c.nome) > c.orcamento)
    .map(c => `• ${c.nome}: ${fmt(gastoCat(st, ym, c.nome))} de ${fmt(c.orcamento)}`);
  const top = st.categorias.map(c => [c.nome, gastoCat(st, ym, c.nome)]).filter(x => x[1] > 0).sort((x, y) => y[1] - x[1]).slice(0, 5)
    .map(([c, v]) => `• ${c}: ${fmt(v)}`);
  return `📅 *Fechamento de ${nomeMes(ym)}*\n` +
    `Receitas: ${fmt(rec)}${var_(rec, recA)}\nDespesas: ${fmt(desp)}${var_(desp, despA)}\nSaldo: *${fmt(rec - desp)}*\n` +
    `💰 Guardado: ${fmt(g)} ${g >= META_GUARDAR ? '✅ bateu a meta' : `(meta ${fmt(META_GUARDAR)})`}` +
    (top.length ? `\n\n*Onde mais gastaram*\n${top.join('\n')}` : '') +
    (estouradas.length ? `\n\n*Passaram do orçamento*\n${estouradas.join('\n')}` : '\n\n👏 Nenhuma categoria passou do orçamento.');
}

export function orcamentos(st, hoje = new Date()) {
  const ym = isoLocal(hoje).slice(0, 7);
  const grupo = { fixa: 'Fixas', variavel: 'Variáveis', excecao: 'Exceções' };
  return `📋 *Orçamentos de ${nomeMes(ym)}*\n` + Object.entries(grupo).map(([k, t]) => {
    const cs = st.categorias.filter(c => (c.classe || 'variavel') === k);
    return cs.length ? `*${t}*\n` + cs.map(c => `• ${c.nome}: ${c.orcamento > 0 ? fmt(c.orcamento) : 'sem orçamento'}` +
      (c.orcamento > 0 ? ` (usado ${pct(gastoCat(st, ym, c.nome) / c.orcamento * 100)})` : '')).join('\n') : '';
  }).filter(Boolean).join('\n') + `\nTotal orçado: ${fmt(soma(st.categorias.map(c => ({ valor: c.orcamento }))))}`;
}

export function listaCategorias(estado) {
  return 'Categorias: ' + estado.categorias.map(c => c.nome).join(', ') + '\nReceitas: ' + FONTES.join(', ');
}

export function ajuda(estado) {
  return `🤖 *Fluxo Contas*: o que dá pra mandar aqui\n` +
    `• *mercado 150,90*: lança um gasto (data de hoje)\n` +
    `• *gasolina 200 ontem* · *farmácia 45 02/11*: com outra data\n` +
    `• *saídas 80 pizza*: com descrição\n` +
    `• *+ salário 4000*: lança uma receita\n` +
    `• *desfazer*: apaga o último que você lançou por aqui\n` +
    `• *resumo*: o mês até agora\n` +
    `• *mercado?*: quanto ainda tem na categoria\n` +
    `• *faltam*: contas fixas do mês ainda não lançadas\n` +
    `• *orçamentos*: lista as categorias e quanto foi usado\n` +
    `• *orçamento mercado 1800*: muda o orçamento da categoria\n` +
    `• *nova academia 99,90*: cria categoria (com *fixa* no fim, entra nas contas fixas do mês)\n` +
    `Automático: resumo toda segunda às 8h e fechamento todo dia 1 às 8h.\n\n` + listaCategorias(estado);
}
