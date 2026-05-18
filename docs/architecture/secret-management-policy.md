# Secret Management Policy

Este documento define a politica de gestao de secrets, chaves e credenciais do Careli Hub.

## Regra absoluta

Secrets nunca devem ser exibidos em:

- chat;
- logs;
- commits;
- prints;
- screenshots;
- documentacao;
- registros operacionais;
- mensagens de erro;
- URLs ou query params;
- payloads de diagnostico.

## O que e secret

Tratar como secret ou credencial sensivel:

- `SUPABASE_SERVICE_ROLE_KEY`;
- `SUPABASE_SECRET_KEY`;
- `POSTGRES_URL` e derivados;
- `POSTGRES_PASSWORD`;
- tokens Vercel;
- API keys externas;
- connection strings;
- JWT secrets;
- protection bypass secrets;
- senhas;
- refresh tokens;
- webhooks com segredo.

## Chaves publicas

Variaveis `NEXT_PUBLIC_*`, anon key e publishable key podem ser publicas por natureza, mas ainda exigem governanca porque:

- sao embutidas no browser/build;
- podem quebrar Auth e REST se apontarem para projeto errado;
- podem causar cruzamento entre Production e Homologacao;
- nao podem substituir service role ou secret key.

Nunca colocar chave privilegiada em `NEXT_PUBLIC_*`.

## Armazenamento permitido

- Vercel Environment Variables para runtime/deploy.
- `.env.local` apenas para desenvolvimento local e fora do Git.
- Supabase Dashboard para geracao/rotacao, quando aprovado.
- Cofre/sistema autorizado pelo Lucas, quando existir.

## Rotacao ou alteracao

Rotacao, criacao, remocao, renomeacao ou copia de secret exige:

- aprovacao explicita do Lucas;
- protocolo;
- owner;
- ambiente alvo;
- plano de rollback;
- redeploy quando necessario;
- healthcheck;
- registro sem valor no Engineering Operations.

## Diagnostico seguro

Durante diagnostico, permitido registrar:

- nome da variavel;
- ambiente;
- se esta presente ou ausente;
- tipo publico/server-only;
- comprimento aproximado apenas quando necessario;
- fingerprint mascarado apenas quando aprovado e sem revelar valor util.

Proibido registrar:

- valor completo;
- prefixo/sufixo suficiente para uso;
- URL com senha;
- token bearer;
- service role;
- secret key.

## Vazamento ou suspeita

Se um secret for exposto:

- parar a operacao;
- marcar incidente como `BLOQUEADO`;
- avisar Lucas;
- acionar InfraOps/Security;
- remover a exposicao de logs/docs se possivel sem apagar historico critico;
- rotacionar apenas com autorizacao;
- registrar causa e mitigacao sem repetir o segredo.
