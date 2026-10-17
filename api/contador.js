// Contador de aparelhos únicos e de pessoas online (função do Vercel, sem dependências).
// Armazenamento: Upstash Redis pela integração oficial do Vercel. Guarda um UUID v4 aleatório gerado no navegador.
// Consumo controlado: limites em memória ANTES do Redis (por IP e global por instância) e UMA chamada atômica
// (script Lua) por visita aceita. O IP é usado só em memória, com hash, para o limite por minuto.
const crypto = require('node:crypto');

function credenciais() {
  const env = process.env;
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN];
  for (const chave of Object.keys(env).sort()) {
    const m = chave.match(/^(.*)_REST_API_URL$/);
    if (m && env[`${m[1]}_REST_API_TOKEN`]) return [env[chave], env[`${m[1]}_REST_API_TOKEN`]];
  }
  return [undefined, undefined];
}
const [URL_REDIS, TOKEN] = credenciais();

const JANELA_ONLINE_MS = 150_000;          // o navegador pulsa a cada 60 s
const LIMITE_POR_IP_MINUTO = 4;
const LIMITE_INSTANCIA_MINUTO = 1_200;     // chamadas ao Redis por minuto, por instância da função
const TETO_APARELHOS = 2_000_000;
const ID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Script atômico: teto de aparelhos + presença online + contagens, numa única chamada.
const SCRIPT = `
if redis.call('SCARD', KEYS[1]) < tonumber(ARGV[2]) then redis.call('SADD', KEYS[1], ARGV[1]) end
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, ARGV[4])
return {redis.call('SCARD', KEYS[1]), redis.call('ZCARD', KEYS[2])}`;

// Limites em memória (valem por instância; nenhuma chamada ao Redis é feita quando estouram).
let minutoAtual = -1;
let chamadasNoMinuto = 0;
const porIp = new Map();
function permitir(ipHash, minuto) {
  if (minuto !== minutoAtual) { minutoAtual = minuto; chamadasNoMinuto = 0; porIp.clear(); }
  const n = (porIp.get(ipHash) || 0) + 1;
  porIp.set(ipHash, n);
  if (n > LIMITE_POR_IP_MINUTO || chamadasNoMinuto >= LIMITE_INSTANCIA_MINUTO) return false;
  chamadasNoMinuto += 1;
  return true;
}

function inteiro(n) { return Number.isInteger(n) && n >= 0; }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_REDIS || !TOKEN) return res.status(503).json({ erro: 'contador sem armazenamento configurado' });
  if (req.method !== 'POST') return res.status(405).json({ erro: 'use POST' });
  let id = '';
  try { id = String((typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}).id || '').toLowerCase(); } catch { /* corpo inválido */ }
  if (!ID_VALIDO.test(id)) return res.status(400).json({ erro: 'id inválido' });

  const minuto = Math.floor(Date.now() / 60_000);
  const ip = String((req.headers || {})['x-forwarded-for'] || '').split(',')[0].trim() || 'sem-ip';
  const ipHash = crypto.createHash('sha256').update(`${ip}|${minuto}`).digest('hex').slice(0, 24);
  if (!permitir(ipHash, minuto)) return res.status(429).json({ erro: 'muitas requisições' });

  const agora = Date.now();
  try {
    const r = await fetch(URL_REDIS, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', SCRIPT, '2', 'ffc:dispositivos', 'ffc:online',
                            id, String(TETO_APARELHOS), String(agora), String(agora - JANELA_ONLINE_MS)]),
    });
    if (!r.ok) throw new Error(`redis ${r.status}`);
    const d = await r.json();
    if (!d || d.error !== undefined || !Array.isArray(d.result) || d.result.length !== 2) throw new Error('resposta inválida');
    const [unicos, online] = d.result;
    if (!inteiro(unicos) || !inteiro(online)) throw new Error('contagem inválida');
    return res.status(200).json({ unicos, online });
  } catch (e) {
    return res.status(502).json({ erro: 'falha no armazenamento' });
  }
};
