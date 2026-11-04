# Fluxo Contas

Robô do grupo **FLUXO CONTAS** no WhatsApp que lança gastos e receitas no app de finanças (Firebase).
Roda no GitHub Actions a cada 5 minutos (agendador do próprio GitHub, costuma atrasar alguns minutos): conecta, trata as mensagens novas do grupo,
responde, manda os avisos do horário e desliga.

## O que dá pra mandar no grupo
`mercado 150,90` · `gasolina 200 ontem` · `farmácia 45 02/11` · `saídas 80 pizza` · `+ salário 4000` ·
`desfazer` · `resumo` · `mercado?` · `faltam` · `orçamentos` · `orçamento mercado 1800` · `nova academia 99,90 fixa` · `ajuda`

Automático: resumo da semana + contas fixas que faltam toda **segunda às 8h**; fechamento do mês todo **dia 1 às 8h**.

## Arquivos
- `contas.mjs`: entende a mensagem e faz as contas (as mesmas do app).
- `bot.mjs`: WhatsApp + Firebase. `node bot.mjs teste "mercado 10"` mostra a resposta sem gravar nada.
- `.github/workflows/fluxo.yml`: a rodada na nuvem.
- `ferramentas/preparar.mjs`: liga o aparelho conectado da nuvem (QR) e gera `estado-inicial.enc`.
- `ferramentas/gravar_segredos.mjs`: grava os Secrets no GitHub.

## Segredos (nunca no código)
- Secrets do GitHub: `CHAVE_ESTADO`, `FIREBASE_KEY`, `FLUXO_GRUPO`, `FLUXO_LAR`.
- No PC: `%USERPROFILE%\.claude\fluxo-contas-firebase.json` (chave do Firebase) e `fluxo-contas-nuvem.json` (chave do estado e usuário do GitHub).
- A conexão do WhatsApp só existe criptografada (`estado-inicial.enc` e o cache do GitHub).

## Se o WhatsApp desconectar
Rodar `node ferramentas/preparar.mjs`, escanear o QR e enviar o `estado-inicial.enc` novo. Depois apagar os caches
`estado-*` em Actions → Caches, para a nuvem começar do estado novo.
