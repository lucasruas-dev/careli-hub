# Portal do incorporador para quatro clientes: plano de construção

> Levantado em 12/08/2026, com o código na mão. Decisões do Lucas registradas na seção 6.
> Tarefas #65 (gestão no Apolo) e #66 (portal e CRM).

## Decisões já tomadas

- **CRM** é a lista de CLIENTES do empreendimento: nome, unidade, situação e contato, só leitura.
- **O Cecílio Rocha CONTINUA com a marca dele.** Os três novos usam o tema do Panteon. Isso NÃO
  pode virar dois códigos: a diferença é casca, o conteúdo é compartilhado.
- A gestão de acessos fica **dentro do Apolo**, acessível com o login normal do Hub.
- Empreendimentos: Recanto do Pará (20), Vista Alegre (29), Lavra do Ouro (1 e 4).
  O Cecílio já tem Garden (39) e VOC (37).

---

# PLANO DE CONSTRUÇÃO: portal do incorporador (4 clientes) + gestão no Apolo

Base verificada nos arquivos abertos nesta sessão (todas as linhas citadas foram lidas, não inferidas do briefing).

---

## 1. ORDEM DAS ENTREGAS

O critério da ordem é um só: nada pode ser feito duas vezes. A casca tem que estar resolvida ANTES de existirem 4 slugs no ar, e a tela de gestão tem que estar de pé ANTES de cadastrar os 3 clientes novos, senão é INSERT manual de novo.

### E0. Coluna de casca em `apolo_incorporadores` (migration, exige OK do Lucas)
Uma coluna só: `tema text not null default 'panteon'` (ou `marca_propria boolean default false`). O Cecílio recebe `'propria'` por UPDATE; os 3 novos nascem no default.
Por que primeiro: é o único item de banco. Se vier depois, a tela de gestão (E2) e o portal (E1) nascem sem o campo e voltam para retrabalho.
Verificação isolada: `select slug, tema from apolo_incorporadores` mostra a coluna, e `/incorporador/<slug do Cecílio>` continua idêntico (ninguém lê o campo ainda).
Alternativa sem migration, se o Lucas não quiser mexer no banco agora: derivar a casca de `logo_path is not null`. Funciona hoje, mas é uma armadilha: no dia em que alguém subir a arte do Recanto do Pará, a casca dele vira "marca própria" sozinha. Só como ponte.

### E1. Refactor da casca no portal (sem mudar nada visível)
Transformar `TEMA_CSS` em função, descer a prop `casca` do servidor, e pagar as 4 dívidas que impedem "uma casca, um conteúdo" (detalhe no item 3).
Por que aqui: é a única entrega que precisa acontecer com UM cliente no ar, porque a prova de que o refactor está certo é o Cecílio continuar pixel a pixel igual.
Verificação isolada: print antes/depois de `/incorporador/<cecilio>` (login e portal logado), idênticos; e o mesmo slug com `tema='panteon'` no banco mostrando a casca Panteon, com as MESMAS telas de dentro (nenhum arquivo de conteúdo tocado no diff).

### E2. Tela de gestão no Apolo (criar incorporador, usuário, vínculos)
Detalhe no item 2.
Por que aqui: sem ela, cadastrar Recanto do Pará (20), Vista Alegre (29) e Lavra do Ouro (1 e 4) é SQL manual em 3 tabelas com RLS deny-all.
Verificação isolada: criar um incorporador de teste inteiro pela tela, sem SQL, e logar no portal dele. Depois desativar e confirmar 404 em `app/incorporador/[slug]/page.tsx:55`.

### E3. Cadastro dos 3 clientes + go-live das cascas
Usa E0+E1+E2. Nenhum código novo, é operação.
Verificação isolada: 4 slugs no ar, 3 com casca Panteon e 1 com a marca do Cecílio, cada conta vendo só os empreendimentos dela na aba Produtos.

### E4. Sidebar de 3 abas (CRM, Vendas, Carteira)
Mexe só no componente `Portal` (`modules/incorporador/PortalIncorporador.tsx:290-398`), no tipo `Aba` (linha 28), na lista `ABAS` (284-288) e nos ternários do `<main>` (380-382). As telas de dentro não sabem que existe navegação.
Verificação isolada: as 3 abas navegam, a Carteira some quando `empreendimentosComCarteira` está vazio (linha 307), e a aba padrão abre com conteúdo (ver risco (g) no item 5).

### E5. Aba CRM (rota + tela)
Detalhe no item 4. Inclui o helper `codigosDosEmpreendimentos(ids)`, que hoje não existe (grep por `select id, code from enterprises` e por `codigosDosEmpreendimentos` em `apps/hub`: zero ocorrências).
Verificação isolada: 401 sem cookie; conta A não enxerga cliente de empreendimento de B (trocar `?empreendimento=` na URL não abre nada); contagem de clientes batendo com a tela interna do Apolo para os mesmos códigos.

### E6. Vendas e Carteira (próxima rodada)
`loadApoloEnterpriseVendas(codes)` (`lib/apolo/vendas.ts:193`) e `loadApoloEnterpriseCarteira(codes)` já entregam o conteúdo. Fica por último porque hoje são `EmBreve` (`PortalIncorporador.tsx:381-382`) e não bloqueiam nada.

---

## 2. TELA DE GESTÃO: dentro do Apolo, não no Setup global

**Onde encaixar:** tela nova "Incorporadores" no sidebar do Apolo, visível só para admin. O Setup global (`app/setup/page.tsx`) tem 3.198 linhas e todas as primitivas (DataGrid, SetupModal, TextInput, FormActions) são funções privadas sem `export`: reusar exige extrair ou copiar. O Apolo custa 3 arquivos tocados e 1 novo.

**Arquivos a criar**
- `apps/hub/modules/apolo/blocks/incorporadores/incorporadores-view.tsx` (a tela: lista, form de criação, painel de usuários, multi-select de empreendimentos com a flag de carteira).
- `apps/hub/app/api/apolo/incorporadores/route.ts` (GET lista + POST cria).
- `apps/hub/app/api/apolo/incorporadores/[id]/route.ts` (PATCH nome, ativo, tema, logo_path).
- `apps/hub/app/api/apolo/incorporadores/[id]/usuarios/route.ts` (POST cria usuário com senha, PATCH ativa/desativa e reseta senha).
- `apps/hub/app/api/apolo/incorporadores/[id]/empreendimentos/route.ts` (PUT: define a lista inteira, upsert pela PK composta + delete dos removidos).

**Arquivos a tocar**
- `lib/apolo/catalog.ts:23-29` (somar `"incorporadores"` ao union `ApoloScreen`), `:31-39` (somar `adminOnly?: boolean` em `ApoloScreenItem`) e `:81-124` (a entrada nova; o ícone `Landmark` já está importado em `:10`).
- `modules/apolo/blocks/shell/apolo-sidebar.tsx:14`: hoje `visibleScreens` é calculado FORA do componente, sem acesso à sessão. Passa a receber `podeAdministrar` por prop e filtrar dentro.
- `modules/apolo/ApoloPage.tsx`: importar `useAuth`, passar `podeAdministrar` ao sidebar (`:430-438`) e somar o render depois de `:474`. Copiar o gate do Iris (`modules/caredesk/IrisPage.tsx:1315-1320`, nav filtrada + render condicional duplo).
- `lib/apolo/incorporador/dados.ts`: ganha as funções de ESCRITA (`criarIncorporador`, `criarUsuarioIncorporador`, `definirEmpreendimentos`). Hoje o arquivo só lê (`:74`, `:117`, `:171`), e o aviso de `:3-6` vale para as novas: rodam com `createApoloAdminClient()`, nunca aceitam filtro do cliente.

**O que reusar**
- Guarda da API: `authorizeApoloAdmin` (`lib/apolo/auth.ts:60`), que já existe. Não repetir o boilerplate de Bearer + service role de `app/api/setup/users/route.ts`.
- Senha: `hashSenhaIncorporador` (`lib/apolo/incorporador/senha.ts:22`), `runtime = "nodejs"` obrigatório. Nunca devolver `senha_hash` na resposta.
- Molde de tela com vínculo N-para-N e fetch autenticado: `modules/apolo/blocks/imobiliarias/vincular-imobiliarias.tsx` (usa `getApoloAccessToken()` + `Authorization: Bearer`).
- Visual: componentes do `@repo/uix` (Surface, Badge, EmptyState, Tooltip) e as classes semânticas `bg-surface / text-ink / border-line` do `styles/globals.css:23-36`. Zero CSS novo, zero cor escrita à mão.
- Lista de empreendimentos do multi-select: `loadApoloEnterprises()` (`lib/apolo/empreendimentos.ts:99`), via a rota `/api/apolo/empreendimentos`. **Gravar sempre os ids REAIS (`linha.stages`), nunca o id sintético `group:<nome>`** (ver risco (a)).

---

## 3. PORTAL: o ponto exato onde a casca troca

Hoje **é possível sem duplicar conteúdo**, mas exige um refactor pequeno, porque o tema é uma constante e não um parâmetro. A boa notícia é que a indireção já existe: nenhuma tela conhece cor, todas leem `T`, e `T` é só `var(--inc-*)` (`modules/incorporador/tema.tsx:45-58`). `TelaProdutos` não recebe uma prop sequer.

**As quatro costuras (é só isso):**

1. `modules/incorporador/tema.tsx:14`: `export const TEMA_CSS = \`...\`` vira `export function temaCss(casca: "panteon" | "propria"): string`. Mesmos nomes de variável nos dois blocos, valores diferentes. Manter a ordem das regras de `:22-27` e o `@media` de `:29-42` intactos: o comentário do arquivo registra que inverter isso apaga as duas logos.
2. `modules/incorporador/PortalIncorporador.tsx:115` e `:312`: os dois únicos `<style>{TEMA_CSS}</style>` passam a `<style>{temaCss(casca)}</style>`.
3. As duas `<Marca>`: `:121-127` (login) e `:327-333` (header). Na casca Panteon, `url`/`escuraUrl` deixam de vir do banco e passam a ser os assets do Panteon.
4. A prop nasce no servidor, em `app/incorporador/[slug]/page.tsx:57-64`, alimentada por `carregarIncorporadorPorSlug` (`lib/apolo/incorporador/dados.ts:74`, campo novo no select da linha 83). Nasce no servidor de propósito: a casca precisa existir ANTES do login, e o token só nasce depois.

**Cuidado de asset (concreto):** em `Marca`, `url` é a logo do tema CLARO (classe `.marca-clara`, `tema.tsx:26`). Os arquivos do Panteon têm o nome invertido em relação a isso: `/panteon-mark-light.png` é a arte CLARA, usada para fundo escuro (`components/panteon/panteon-loading.tsx:57`, no ramo `inverse`), e `/panteon-mark.png` é a escura. Então `url="/panteon-mark.png"` e `escuraUrl="/panteon-mark-light.png"`. E existe um buraco de arte: só há `panteon-logo-light.png` (logotipo claro, usado em `app/login/page.tsx:46`), não existe o logotipo Panteon para fundo claro em `apps/hub/public`. Na tela de login do portal (logo de 190px de altura) ou usamos a marca, ou o Lucas manda a arte.

**O que precisa mudar ANTES, senão a casca não fecha:**
- `modules/incorporador/TelaMasterplan.tsx:27-32`: `SHELL` com hex cravado (`#ffffff`, `#dce2ea`, `#121722`, `#667085`) fora do sistema de variáveis. Trocar por `T`. Sem isso, o cliente com casca Panteon abre o masterplan e a tela cheia ignora o tema (e o dark).
- `modules/incorporador/PortalIncorporador.tsx:242`: `background: "#fdf3f2"` solto no bloco de erro. Virar `T.dangerBg`, que já existe (`tema.tsx:51`) e já tem valor nos dois temas (`:18` e `:33`).
- Divergência marca x nome: no header (`:327-333`) o `nome` vem do cookie e a `url` vem do slug da URL (`page.tsx:57-64`). Com 4 slugs no ar isso passa a acontecer de verdade (risco (d)).
- `styles/globals.css:42-45`: `html { min-width: 1024px }`. O portal usa só `className="inc"` (`PortalIncorporador.tsx:103` e `:311`) e não dispara nenhuma das exceções de `:47-68`. Adicionar `html:has(.inc), body:has(.inc) { min-width: 0; overflow-x: hidden; }` no molde das linhas 64-68.

**Recomendação contrária a uma das varreduras:** NÃO mapear `--inc-*` para `var(--uix-*)`. Os `--uix-*` são escritos INLINE no `:root` pelo `providers/theme-provider.tsx`, que começa sempre no claro e cujo toggle mora na topbar do hub interno (`components/panteon/panteon-topbar-user.tsx:127-151`), que o cliente externo não tem. Herdar o uix trava o portal no claro e amarra a tela do cliente ao provider do hub. O bloco Panteon do `temaCss` já é a paleta do Panteon com valores literais (`tema.tsx:16-19`), e continua respondendo ao `prefers-color-scheme` sem JavaScript. Duas cascas, um conteúdo, portal autocontido.

---

## 4. ABA CRM: consulta e recorte

**A consulta.** Três dos quatro campos pedidos já existem em `loadApoloEnterpriseVendas(codes)` (`lib/apolo/vendas.ts:193`): nome (`client.name`, montado em `mapVendaUnit:521-557`), unidade (`code`/`block`/`lot`) e situação (`stage`, derivado em `deriveStage:510-519`). Falta só o CONTATO: o SELECT de `:222-243` não lê `phones` nem `emails`.

O SQL do contato já está escrito no repo, em `lib/apolo/server.ts:1456-1477`: telefone vem da tabela polimórfica `phones` (`ownertable_type = 'User'`), preferindo WhatsApp, com coalesce para `u.cellphone`/`u.phone`; e-mail com coalesce para a tabela `emails`. É copiar as duas subqueries com alias `cli`.

**Não estender `ApoloVendaUnit`.** Criar `loadApoloIncorporadorClientes(codes)` no próprio `vendas.ts`, reusando `nameSql`, `buildUnitCode` e `deriveStage`, com SELECT próprio e só as colunas da lista. Motivo no risco (e).

**O recorte, em 5 passos, na rota nova `app/api/incorporador/clientes/route.ts`:**
1. `const sessao = sessaoDoRequest(request)` (`lib/apolo/incorporador/sessao.ts:126`); sem sessão, 401.
2. `const ids = empreendimentosPermitidos(sessao, url.searchParams.get("empreendimento"))` (`sessao.ts:148-161`). Essa função foi escrita exatamente para isso e ainda não tem consumidor: `produtos/route.ts:121` e `masterplan/route.ts:98` refazem o Set na mão. O CRM é o primeiro a usá-la. Lista vazia, 403.
3. Traduzir ids para codes com um helper novo `codigosDosEmpreendimentos(ids)` (`select id, code from enterprises where id in (?)`). Hoje o único caminho é `loadApoloEnterprises()` (`empreendimentos.ts:99`), que faz GROUP BY sobre todas as enterprises com 10 agregações de `sale_status` (`:112-153`) só para descobrir 1 a 4 códigos, e é o que `masterplan/route.ts:77` paga hoje.
4. Chamar o loader com esses códigos. Nunca aceitar `codes` da query: o código sai da tradução dos ids autorizados, não do que o cliente mandou.
5. Responder com `Cache-Control: no-store` (padrão de `produtos/route.ts:180`).

O gate de borda já cobre a rota de graça (`proxy.ts:140-145` libera `/api/incorporador/*` com o cookie presente), mas presença de cookie não é escopo: `sessaoDoRequest` dentro da rota continua obrigatório.

**Lavra do Ouro (1 e 4):** com os dois ids no token, a tradução devolve os dois códigos e a lista pede os dois de uma vez. Se um dia só um estiver liberado, a tradução por id já resolve sozinha, sem precisar do `recortar` de `produtos/route.ts:54`.

**A tela:** copiar o esqueleto de `TelaProdutos.tsx` (fetch com `cache: "no-store"` em useEffect com flag de vida, cor só por `T.*`, nenhuma prop de marca). Assim ela funciona nas duas cascas sem uma linha diferente.

---

## 5. O QUE VAI QUEBRAR (com o caso concreto)

**(a) Vincular pelo id sintético.** `groupEnterpriseRows` cria linha com id `group:Lavra do Ouro`. Se o multi-select da tela de gestão gravar esse id, a sessão nasce (a lista não está vazia, `sessao.ts:110` passa), mas `permitidos.has(String(linha.id))` em `produtos/route.ts:64` nunca casa: o cliente loga e vê o portal VAZIO, sem erro nenhum. A tela tem que gravar `stages[].id`.

**(b) Trocar o tema sem alcançar o masterplan.** Cliente novo com casca Panteon abre o card, entra em `TelaMasterplan` e cai num bloco de cor fixa (`TelaMasterplan.tsx:27-32`), mais o `comTemaClaro` aplicado ao HTML servido (`app/api/incorporador/masterplan/route.ts:123`). Metade escura, metade clara.

**(c) Celular.** `globals.css:42` impõe `min-width: 1024px` e o portal não dispara exceção. O incorporador abre no telefone e a tela sai cortada para a direita, exatamente o defeito de 20/jul das telas públicas registrado em `:60-63`.

**(d) Logo de um, nome de outro.** Logado como Vista Alegre, abrindo `/incorporador/recanto-do-para`: o header monta `nome` do cookie e `url` do slug (`PortalIncorporador.tsx:327-333`). Os DADOS continuam certos (o escopo é sempre o do token), mas o cliente vê a marca de outro incorporador na tela dele. Com um cliente só isso nunca ocorreu; com quatro, ocorre.

**(e) Estender o tipo compartilhado.** `ApoloVendaUnit` (`vendas.ts:110-121`) alimenta a aba Vendas do Apolo interno. Somar telefone/e-mail ali coloca PII de comprador em telas que não pediram e encarece o SELECT para todo mundo.

**(f) Allowlist descasada.** `COM_TELA_INTERNA` (`produtos/route.ts:41`, hoje GDN/VLO/VOC/VOL) e `TELAS` (`masterplan/route.ts:30-35`) têm que andar juntas. Adicionar código em uma só entrega botão que abre quadro vazio, ou 404. Nenhum dos 3 clientes novos está nas duas, então hoje eles caem em "Masterplan em breve".

**(g) Aba padrão órfã.** `useState<Aba>("produtos")` (`PortalIncorporador.tsx:43`). Se Produtos sair da lista ao virar CRM/Vendas/Carteira, o `<main>` (`:379-383`) não renderiza nada: tela branca logo depois do login.

**(h) Escopo do C2X em vez do escopo da 0083.** `loadApoloCarteiraScoped({kind:"incorporador"})` filtra por `enterprises.incorporador_id` do legado, um vínculo paralelo ao `apolo_incorporador_empreendimentos`. Usá-la faz a permissão do portal deixar de ser a tabela que a tela de gestão administra.

**(i) A regra nova não alcança o passado.** O escopo viaja assinado dentro do token, com TTL de 12h (`sessao.ts:27` e `:66`). Tirar um empreendimento pela tela de gestão NÃO afeta quem já está logado, até 12h. A tela precisa dizer isso em texto, ou o portal precisa revalidar.

**(j) Tela restaurada sem permissão.** `usePersistedState("apolo.activeScreen", "crm")` (`ApoloPage.tsx:40-43`): quem abriu Incorporadores e depois perdeu o papel de admin volta preso numa tela que não deve ver. Precisa de fallback para `crm` quando a tela não está na lista visível.

**(k) RLS deny-all e o erro silencioso.** As 3 tabelas da 0083 não têm policy: qualquer leitura pelo navegador volta vazia sem erro claro. Toda a gestão é server-side com `createApoloAdminClient()`. E upsert em coluna NOT NULL sem default falha calado: checar `error` em toda escrita.

**(l) Fail-open de desenvolvimento.** `lib/apolo/auth.ts:90-94`: sem client Supabase server-side a autorização devolve `{ok: true, userId: "local-hub-user"}`. Em local a tela de admin abre para qualquer um. Teste de permissão só vale em preview, nunca na máquina.

**(m) Sigla já tomada.** `ENTERPRISE_GROUPS` (`lib/guardian/c2x-analytics.ts:31-36`) consolida `RDP + RPC + RPS` como "Rio de Pedras". Se o código do Recanto do Pará for RDP, o card dele consolida com empreendimento de outro dono. E `EXCLUDED_ENTERPRISE_CODES` (`:27`) some com TSC/SDT/LAB/LAG dentro de `vendas.ts:200` sem avisar. Confirmar os códigos dos enterprises 20, 29, 1 e 4 antes de montar as telas.

---

## 6. O QUE PRECISA DE DECISÃO DO LUCAS (antes de começar)

1. **Migration da coluna de casca** em `apolo_incorporadores` (operação sensível). Aprovado? Se não, seguimos com a ponte por `logo_path`, que tem a armadilha descrita em E0.
2. **A aba Produtos continua?** O pedido são 3 abas (CRM, Vendas, Carteira), mas Produtos é a única com conteúdo hoje e é por ela que o masterplan interno abre. Vira a quarta aba, ou some?
3. **Quem é "cliente" na aba CRM:** só quem já tem unidade no C2X, ou também quem está na esteira (`apolo_esteira`, CAD sem lote ainda)? Isso muda a consulta inteira.
4. **Contato do cliente vai completo para fora?** Telefone e e-mail do comprador saindo da Careli para o incorporador é PII. Completo, mascarado, ou só telefone?
5. **Senha do usuário do incorporador:** gerada pelo sistema e exibida uma vez, ou digitada pelo operador? E existe "esqueci a senha", ou continua o texto atual "Fale com a Careli" (`PortalIncorporador.tsx:276`)?
6. **Dark mode do portal:** continua decidido pelo aparelho (`prefers-color-scheme`, como hoje) ou passa a seguir o toggle do hub? Minha recomendação é continuar no aparelho, pelo motivo do item 3.
7. **Título da aba e rodapé dos 3 novos:** hoje `generateMetadata` corta o "| Panteon" de propósito (`app/incorporador/[slug]/page.tsx:38-42`). Para quem usa a casca Panteon, a aba diz "Recanto do Pará · Portal" ou "... | Panteon"? E o rodapé "Tecnologia C2X" fica igual nos quatro?
8. **Códigos do C2X dos enterprises 20, 29, 1 e 4:** preciso confirmar contra `ENTERPRISE_GROUPS` e `EXCLUDED_ENTERPRISE_CODES` (risco (m)). Consigo confirmar com acesso de leitura ao C2X.
9. **Masterplan interno dos 3 novos:** nenhum está nas allowlists. Entra nesta rodada (exige o HTML em `apps/hub/masterplans-internos/`, que hoje tem só `garden.html` e `vale-do-ouro.html`) ou o card fica com "Masterplan em breve"?
10. **Logo dos novos:** com casca Panteon, ainda sobe a logo do empreendimento no card? Lembrando que `resolverLogo` só aceita arquivo em `public/` (`page.tsx:24-28`), bucket privado ainda não está ligado.
11. **Onde a tela de gestão mora:** dentro do Apolo (minha recomendação) ou dentro do Setup global do Hub?
12. **Quem administra incorporador:** só `admin` do Hub, ou `leader` também?