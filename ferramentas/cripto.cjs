// Criptografia do estado guardado entre rodadas (AES-256-GCM: 12 bytes de IV + texto cifrado + 16 bytes de tag).
// A chave (32 bytes em base64url) vem de uma variável de ambiente, nunca da linha de comando.
//   node cripto.cjs cifrar   <ENV_DA_CHAVE> <entrada> <saida.enc>
//   node cripto.cjs decifrar <ENV_DA_CHAVE> <entrada.enc> <saida>
//   node cripto.cjs nova-chave
const crypto = require('crypto'), fs = require('fs');

function chave(nomeEnv) {
  const k = Buffer.from(process.env[nomeEnv] || '', 'base64url');
  if (k.length !== 32) throw new Error('variável ' + nomeEnv + ' sem chave válida');
  return k;
}
function cifrar(k, dados) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv);
  return Buffer.concat([iv, c.update(dados), c.final(), c.getAuthTag()]);
}
function decifrar(k, buf) {
  const d = crypto.createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]);
}

const [cmd, env, a, b] = process.argv.slice(2);
if (cmd === 'nova-chave') console.log(crypto.randomBytes(32).toString('base64url'));
else if (cmd === 'cifrar') fs.writeFileSync(b, cifrar(chave(env), fs.readFileSync(a)));
else if (cmd === 'decifrar') fs.writeFileSync(b, decifrar(chave(env), fs.readFileSync(a)));
else { console.error('uso: node cripto.cjs cifrar|decifrar <ENV_DA_CHAVE> <entrada> <saida> | nova-chave'); process.exit(1); }
