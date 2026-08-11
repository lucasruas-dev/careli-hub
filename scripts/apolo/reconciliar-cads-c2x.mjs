// RECONCILIA as CADs que JÁ ESTÃO no C2X e que a nossa fila não enxerga.
//
// Uso (da raiz do repo, com `npm --prefix apps/hub run dev` no ar):
//   node scripts/apolo/reconciliar-cads-c2x.mjs              -> ENSAIO: mostra os pares, grava NADA
//   node scripts/apolo/reconciliar-cads-c2x.mjs --aplicar    -> grava o c2x_user_id na nossa fila
//   node scripts/apolo/reconciliar-cads-c2x.mjs --app=https://c2x.app.br   -> outro app
//   node scripts/apolo/reconciliar-cads-c2x.mjs --tudo       -> lista os pares sem cortar em 20
//
// ── O PROBLEMA ────────────────────────────────────────────────────────────────────────────────
// A `apolo_c2x_sync` só ganha linha quando NÓS enviamos. Quem entrou no C2X por outro caminho
// (importação antiga, cadastro feito lá dentro) fica invisível para ela: o card acusa "não subiu"
// para gente que está lá desde sempre e, no clique, a API responde "E-mail de acesso já cadastrado"
// — que é ela dizendo que a PESSOA EXISTE, e a tela lendo como erro de cadastro.
// Reconciliar = achar o usuário no C2X pelo DOCUMENTO e gravar o `c2x_user_id` na nossa fila.
//
// ── AS QUATRO DECISÕES DE DESENHO, E O PORQUÊ ─────────────────────────────────────────────────
//
// 1. ESTE SCRIPT NÃO ENVIA NINGUÉM, E NÃO É POR EDUCAÇÃO: É POR CAMINHO.
//    A gravação vai por `POST /api/apolo/c2x-sync/lote` com `apenasReconciliar: true`, um modo em
//    que NÃO EXISTE caminho até o `POST /api/v1/users` do C2X. Não é "o script se comporta bem": é
//    que o modo não tem a porta. Criar cadastro no C2X não tem desfazer, e um script de conserto de
//    fila não pode ter, nem por engano, o poder de criar cliente em produção.
//
// 2. QUEM DECIDE QUAL PAR CASA É O SERVIDOR, NUNCA ESTE ARQUIVO.
//    A separação RECONCILIAR / SUSPEITO sai do mesmo `processarLoteC2x` que o botão do card e o
//    envio automático usam (a comparação de nomes mora em lib/apolo/c2x-nome-confere.ts). Se este
//    script tivesse a sua própria régua de "os nomes batem", um dia as duas divergiriam — e a versão
//    frouxa seria a que roda em lote, sobre centenas de fichas, sem ninguém olhando.
//    O que o script faz sozinho é LEITURA de estado (raio-x) e a apresentação lado a lado.
//
// 3. O ENSAIO É O PADRÃO, E O RISCO APARECE ANTES DA GRAVAÇÃO.
//    O risco desta operação não é escrever demais: é CASAR A PESSOA ERRADA. Um CPF digitado errado
//    no Apolo bate com outra pessoa no C2X e a CAD de um vira o cliente de outro, num sistema de
//    CONTRATOS, em silêncio (o id volta certo, a gravação dá certo). Por isso a amostra mostra NOME
//    NO APOLO e NOME NO C2X lado a lado — é a conferência que uma pessoa faz de olho, em segundos.
//
// 4. NOME DIVERGENTE NÃO É RECONCILIADO. NEM AQUI, NEM COM --aplicar.
//    Esses pares saem numa lista SEPARADA de suspeitos, com o motivo. Nenhum deles é gravado por
//    este script; nenhum deles é enviado pelo botão do card (o servidor barra os dois caminhos).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// ⚠️ A COMPARAÇÃO DE NOMES É IMPORTADA DO SERVIDOR, NÃO COPIADA.
//
// O Node 22+ executa TypeScript por remoção de tipos, e `c2x-nome-confere.ts` não importa nada —
// então este script roda EXATAMENTE a função que o botão do card e o lote usam. É a diferença entre
// uma régua e duas: duas réguas divergem um dia, e a frouxa é sempre a que roda em lote, sobre
// centenas de fichas, sem ninguém olhando (foi assim com as duas `matchFaixaRendaId`).
//
// O aviso MODULE_TYPELESS_PACKAGE_JSON é ruído desse mecanismo (o apps/hub não é `type: module`, e
// não pode ser: é um app Next). Filtramos SÓ ele — qualquer outro aviso do Node continua aparecendo,
// porque um relatório que engole avisos é pior do que um relatório feio.
const emitirAviso = process.emitWarning;
process.emitWarning = (aviso, ...resto) => {
  const texto = typeof aviso === "string" ? aviso : String(aviso?.message ?? "");
  const ehORuido =
    resto.some((r) => typeof r === "string" && r.includes("MODULE_TYPELESS")) ||
    /MODULE_TYPELESS_PACKAGE_JSON|Module type of file/.test(texto);
  if (!ehORuido) emitirAviso.call(process, aviso, ...resto);
};

// ── argumentos ────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const semBanco = args.includes("--sem-banco");
const mostrarTudo = args.includes("--tudo");

// O APP do hub (quem tem a regra e as envs), não o C2X. Padrão: o dev local.
const APP = (args.find((a) => a.startsWith("--app="))?.slice(6) || "http://127.0.0.1:3001").replace(/\/+$/, "");

// O host do C2X de PRODUÇÃO, escrito por extenso — o mesmo gabarito do subir-cads-pendentes.mjs.
const C2X_PRODUCAO = "sistema.careli.adm.br";

// Quantos pares a amostra mostra por padrão. A conferência é de olho: uma lista de 200 linhas não é
// conferida, é rolada. `--tudo` existe para quem vai revisar de verdade, com tempo.
const AMOSTRA = mostrarTudo ? Number.POSITIVE_INFINITY : 20;

// ── env ───────────────────────────────────────────────────────────────────────────────────────
const raizApp = path.resolve(process.cwd(), "apps/hub");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(raizApp, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const { confereNomeC2x } = await import(
  pathToFileURL(path.join(raizApp, "lib/apolo/c2x-nome-confere.ts")).href
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const SECRET = env.CRON_SECRET;
for (const [nome, valor] of [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
  ["CRON_SECRET", SECRET],
]) {
  if (!valor) {
    console.error(`ERRO: falta ${nome} em apps/hub/.env.local.`);
    process.exit(1);
  }
}

// ── leitura do Apolo (Supabase REST, service role) ─────────────────────────────────────────────
async function ler(tabela, query) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${(await resp.text()).slice(0, 200)}`);
  return resp.json();
}

// O PostgREST corta em 1000 linhas por resposta; sem paginar, a tabela vira silêncio no dia em que
// passar de mil.
async function lerTudo(tabela, query) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const bloco = await ler(tabela, `${query}&limit=1000&offset=${offset}`);
    out.push(...bloco);
    if (bloco.length < 1000) return out;
  }
}

// `.in()` com centenas de uuids estoura o tamanho da URL do PostgREST e volta 400. Blocos de 100.
async function lerPorIds(tabela, query, ids, coluna = "entity_id") {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const bloco = ids.slice(i, i + 100);
    out.push(...(await ler(tabela, `${query}&${coluna}=in.(${bloco.join(",")})`)));
  }
  return out;
}

// ── a rota que tem a regra ─────────────────────────────────────────────────────────────────────
async function chamarApp(caminho, corpo) {
  let resp;
  try {
    resp = await fetch(`${APP}${caminho}`, {
      body: JSON.stringify(corpo),
      headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
      method: "POST",
    });
  } catch (erro) {
    console.error(`ERRO: não consegui falar com ${APP} (${erro.message}).`);
    console.error(`      O servidor está no ar? (npm --prefix apps/hub run dev)`);
    process.exit(1);
  }
  const texto = await resp.text();
  if (!resp.ok) {
    console.error(`ERRO HTTP ${resp.status} em ${caminho}: ${texto.slice(0, 300)}`);
    process.exit(1);
  }
  const json = JSON.parse(texto);
  return json.data ?? json;
}

const soDigitos = (v) => String(v ?? "").replace(/\D+/g, "");
const corta = (v, n) => (String(v ?? "").length > n ? `${String(v).slice(0, n - 1)}…` : String(v ?? ""));

// ── o banco de PRODUÇÃO do C2X (read-only) ────────────────────────────────────────────────────
// Quais destes documentos existem como usuário no C2X, e COM QUE NOME. O nome vem na mesma consulta
// de propósito: ele é a segunda testemunha do casamento, e buscá-lo depois seria uma ida ao MySQL de
// produção por pessoa. Mesma comparação do servidor: só dígitos dos dois lados, porque no C2X o
// cpf/cnpj pode estar com ou sem máscara.
// Devolve `null` quando não deu para consultar — quem chama distingue "não achei" de "não perguntei".
async function usuariosNoC2x(documentos) {
  const limpos = [...new Set(documentos.map(soDigitos).filter(Boolean))];
  if (limpos.length === 0) return new Map();
  try {
    const requireDoRepo = createRequire(path.join(raizApp, "package.json"));
    const mysql = requireDoRepo("mysql2/promise");
    const conexao = await mysql.createConnection({
      database: env.GUARDIAN_DB_NAME,
      dateStrings: true,
      host: env.GUARDIAN_DB_HOST,
      password: env.GUARDIAN_DB_PASSWORD,
      port: Number(env.GUARDIAN_DB_PORT || 3306),
      user: env.GUARDIAN_DB_USER,
    });
    const semMascara = (col) =>
      `REPLACE(REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),'/',''),' ','')`;
    const achados = new Map();
    // Em blocos: um IN com centenas de valores é pesado, e o legado é de produção.
    for (let i = 0; i < limpos.length; i += 200) {
      const bloco = limpos.slice(i, i + 200);
      const marcadores = bloco.map(() => "?").join(",");
      const [linhas] = await conexao.query(
        `SELECT id, name, ${semMascara("cpf")} AS doc FROM users
          WHERE ${semMascara("cpf")} IN (${marcadores})
         UNION ALL
         SELECT id, name, ${semMascara("cnpj")} AS doc FROM users
          WHERE ${semMascara("cnpj")} IN (${marcadores})`,
        [...bloco, ...bloco],
      );
      for (const l of linhas) {
        const doc = String(l.doc ?? "");
        const id = Number(l.id);
        if (!doc || !Number.isFinite(id)) continue;
        // Havendo mais de um, vence o MAIOR id — o mesmo critério do servidor. E o NOME anda com o
        // id: guardar o nome de um cadastro e o id de outro aprovaria o par errado.
        const atual = achados.get(doc);
        if (atual && id <= atual.id) continue;
        achados.set(doc, { id, nome: String(l.name ?? "").trim() });
      }
    }
    await conexao.end();
    return achados;
  } catch (erro) {
    console.log(`(Não deu para consultar o banco do C2X: ${erro.message})`);
    return null;
  }
}

// Os NOMES dos usuários do C2X por `users.id`. Serve à auditoria das fichas que JÁ estão ligadas a
// um id: elas foram casadas SÓ pelo documento, antes de existir a conferência de nome, e nunca
// ninguém olhou se o par fecha.
async function nomesPorIdNoC2x(ids) {
  const limpos = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n)))];
  if (limpos.length === 0) return new Map();
  try {
    const requireDoRepo = createRequire(path.join(raizApp, "package.json"));
    const mysql = requireDoRepo("mysql2/promise");
    const conexao = await mysql.createConnection({
      database: env.GUARDIAN_DB_NAME,
      dateStrings: true,
      host: env.GUARDIAN_DB_HOST,
      password: env.GUARDIAN_DB_PASSWORD,
      port: Number(env.GUARDIAN_DB_PORT || 3306),
      user: env.GUARDIAN_DB_USER,
    });
    const achados = new Map();
    for (let i = 0; i < limpos.length; i += 200) {
      const bloco = limpos.slice(i, i + 200);
      const [linhas] = await conexao.query(
        `SELECT id, name FROM users WHERE id IN (${bloco.map(() => "?").join(",")})`,
        bloco,
      );
      for (const l of linhas) achados.set(Number(l.id), String(l.name ?? "").trim());
    }
    await conexao.end();
    return achados;
  } catch (erro) {
    console.log(`(Não deu para consultar o banco do C2X: ${erro.message})`);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. RAIO-X: quem tem CAD e não tem id do C2X na nossa fila
// ══════════════════════════════════════════════════════════════════════════════════════════════
console.log("Lendo o Apolo...");

const cads = await lerTudo("apolo_esteira", "select=entity_id,empreendimento,etapa");
const fila = await lerTudo(
  "apolo_c2x_sync",
  "select=entity_id,status,c2x_user_id,erro,atualizado_em",
);

// Uma pessoa pode ter mais de uma CAD (uma por empreendimento) e a fila do C2X é por PESSOA.
const entityIds = [...new Set(cads.map((c) => c.entity_id).filter(Boolean))];
const filaPorEntidade = new Map(fila.map((f) => [f.entity_id, f]));
const temIdNaFila = new Set(fila.filter((f) => f.c2x_user_id != null).map((f) => f.entity_id));
const semIdNaFila = entityIds.filter((id) => !temIdNaFila.has(id));

const entidades = await lerPorIds(
  "apolo_entities",
  "select=id,display_name,legal_name,document_masked,entity_kind," +
    "origem:metadata->>source,sincronizada:metadata->>c2xSynced," +
    "idNoMeta:metadata->>c2xUserId,papel:metadata->>bornRole",
  entityIds,
  "id",
);
const porEntidade = new Map(entidades.map((e) => [e.id, e]));

// A prova de que a pessoa está no C2X vem do BANCO DE PRODUÇÃO dele, pelo documento — nunca da
// nossa fila (que só conhece os nossos envios) nem da resposta da API (que dizer "criei" não prova).
const achadosNoC2x = semBanco
  ? null
  : await usuariosNoC2x(semIdNaFila.map((id) => porEntidade.get(id)?.document_masked));

const noC2xPorEntidade = new Map();
if (achadosNoC2x) {
  for (const id of semIdNaFila) {
    const achado = achadosNoC2x.get(soDigitos(porEntidade.get(id)?.document_masked));
    if (achado) noC2xPorEntidade.set(id, achado);
  }
}

console.log(`\nCADs na esteira: ${cads.length} · pessoas distintas: ${entityIds.length}`);
console.log(`  com id do C2X já gravado na nossa fila ... ${temIdNaFila.size}`);
console.log(`  SEM id na nossa fila ..................... ${semIdNaFila.length}`);
console.log(
  `      destas, achadas no C2X pelo documento . ${achadosNoC2x ? noC2xPorEntidade.size : "?"}` +
    `${achadosNoC2x ? " (são as candidatas à reconciliação)" : " — NÃO CONFERIDO, banco indisponível"}`,
);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. A REGRA DO SERVIDOR: quem casa e quem é suspeito
// ══════════════════════════════════════════════════════════════════════════════════════════════
const ensaio = await chamarApp("/api/apolo/c2x-sync/lote", { dryRun: true });
const itens = ensaio.itens ?? [];

console.log(`\n╔══════════════════════════════════════════════════════════`);
console.log(`║  DESTINO DA ESCRITA NO C2X: ${ensaio.hostDestino}`);
console.log(
  `║  ${ensaio.hostDestino === C2X_PRODUCAO ? `É o C2X de PRODUÇÃO (${C2X_PRODUCAO}).` : `ATENÇÃO: NÃO é o C2X de produção (${C2X_PRODUCAO})!`}`,
);
console.log(`║  Banco do C2X que foi LIDO: ${env.GUARDIAN_DB_HOST ?? "(não configurado)"} / ${env.GUARDIAN_DB_NAME ?? ""}`);
console.log(`║`);
console.log(`║  ⚠️ NESTA OPERAÇÃO NADA É ENVIADO AO C2X, nem com --aplicar.`);
console.log(`║  A gravação é só na NOSSA fila (apolo_c2x_sync), pelo modo`);
console.log(`║  apenasReconciliar, que não tem caminho até o POST de criação.`);
console.log(`╚══════════════════════════════════════════════════════════`);

// O lote parte de `apolo_entities`; o raio-x parte da esteira. Pode haver candidata sem CAD, e sem
// completar o mapa ela apareceria sem nome e sem documento na amostra — logo, não conferida.
const semNoMapa = itens.map((i) => i.entityId).filter((id) => !porEntidade.has(id));
if (semNoMapa.length > 0) {
  const extras = await lerPorIds(
    "apolo_entities",
    "select=id,display_name,legal_name,document_masked,entity_kind," +
      "origem:metadata->>source,sincronizada:metadata->>c2xSynced," +
      "idNoMeta:metadata->>c2xUserId,papel:metadata->>bornRole",
    semNoMapa,
    "id",
  );
  for (const e of extras) porEntidade.set(e.id, e);
  console.log(`(${extras.length} candidatas do servidor não têm CAD na esteira — entram do mesmo jeito.)`);
}

// RECONCILIÁVEIS: o servidor achou a pessoa no C2X pelo documento E o nome sustenta o casamento.
const reconciliaveis = itens.filter((i) => i.status === "ja_no_c2x");
// SUSPEITOS: o documento bateu e o casamento não fecha. São DOIS casos, e os dois têm a ver com o
// C2X (é isso que os separa das divergências ficha x importação, que não têm):
//   • `c2xUserId` presente  -> achou UM cadastro e o NOME não sustenta;
//   • `c2xCandidatos`       -> achou VÁRIOS cadastros com o mesmo documento, e escolher um deles
//                              seria apostar (medição de 08/08: o "maior id" erra metade das vezes).
const suspeitos = itens.filter(
  (i) => i.status === "conferir" && (i.c2xUserId != null || (i.c2xCandidatos ?? []).length > 0),
);

console.log(`\nO servidor olhou ${itens.length} fichas candidatas e disse:`);
console.log(`  RECONCILIAR (documento e nome batem) ..... ${reconciliaveis.length}`);
console.log(`  SUSPEITOS (documento bate, nome NÃO) ..... ${suspeitos.length}`);

// ── a amostra: NOME NO APOLO x NOME NO C2X, lado a lado ───────────────────────────────────────
function linhaDoPar(i) {
  const e = porEntidade.get(i.entityId) ?? {};
  const apolo = corta(i.nome || e.display_name || e.legal_name, 34).padEnd(34);
  const varios = (i.c2xCandidatos ?? []).length > 0;
  const c2x = corta(varios ? `⚠️ ${i.c2xCandidatos.length} cadastros` : (i.nomeNoC2x ?? "(sem nome)"), 34).padEnd(34);
  const id = varios ? i.c2xCandidatos.join("/") : String(i.c2xUserId ?? "");
  return `  ${apolo} | ${c2x} | ${corta(id, 6).padStart(6)} | ${e.document_masked ?? ""}`;
}

if (reconciliaveis.length > 0) {
  console.log(`\n── A RECONCILIAR: confira NOME NO APOLO x NOME NO C2X ─────────────────────`);
  console.log(`  ${"NOME NO APOLO".padEnd(34)} | ${"NOME NO C2X".padEnd(34)} | id C2X | documento`);
  console.log(`  ${"-".repeat(34)} | ${"-".repeat(34)} | ------ | ---------`);
  for (const i of reconciliaveis.slice(0, AMOSTRA)) console.log(linhaDoPar(i));
  if (reconciliaveis.length > AMOSTRA) {
    console.log(`  · ... e mais ${reconciliaveis.length - AMOSTRA} (use --tudo para ver todos)`);
  }
}

if (suspeitos.length > 0) {
  console.log(`\n🔴 SUSPEITOS — NÃO SERÃO RECONCILIADOS (nem com --aplicar) ────────────────`);
  console.log(`O documento bateu, mas o nome não sustenta que seja a mesma pessoa. Reconciliar`);
  console.log(`ligaria a CAD ao cliente errado; enviar criaria um cadastro com documento repetido.`);
  console.log(`O conserto é conferir o CPF/CNPJ na ficha do Apolo.`);
  console.log(`  ${"NOME NO APOLO".padEnd(34)} | ${"NOME NO C2X".padEnd(34)} | id C2X | documento`);
  console.log(`  ${"-".repeat(34)} | ${"-".repeat(34)} | ------ | ---------`);
  for (const i of suspeitos) {
    console.log(linhaDoPar(i));
    console.log(`      ↳ ${corta((i.divergencias ?? [])[0] ?? i.erro, 100)}`);
  }
}

// ── quem está no C2X e o servidor NEM LISTOU ───────────────────────────────────────────────────
// Sem isto essas fichas somem da conta: estão no C2X, não têm id na nossa fila, e não aparecem em
// lugar nenhum do relatório. Elas não são reconciliadas por aqui — o filtro de candidatas do lote é
// que não as considera — mas precisam ser vistas, porque é o mesmo silêncio, só que mais fundo.
const listadas = new Set(itens.map((i) => i.entityId));
const foraDaFila = [...noC2xPorEntidade.keys()].filter((id) => !listadas.has(id));
if (foraDaFila.length > 0) {
  console.log(`\nNo C2X, sem id na nossa fila, e FORA da fila do servidor: ${foraDaFila.length}`);
  const motivos = new Map();
  for (const id of foraDaFila) {
    const e = porEntidade.get(id) ?? {};
    const motivo =
      e.origem !== "apolo"
        ? `ficha com source "${e.origem ?? "vazio"}" (nasceu no C2X, não no Apolo): já existe lá, nada a reconciliar`
        : e.sincronizada === "true" || e.idNoMeta
          ? "já carimbada na entidade (metadata.c2xSynced / c2xUserId), só a linha da fila está velha"
          : `papel "${e.papel ?? "sem papel"}" não sobe pela fila de cliente, ou ficha sem cadastro`;
    motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1);
  }
  for (const [motivo, qtd] of [...motivos].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(qtd).padStart(3)} × ${motivo}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 3. AUDITORIA DAS JÁ LIGADAS — o passado também foi casado só pelo documento
// ══════════════════════════════════════════════════════════════════════════════════════════════
// A conferência de nome nasceu agora. Todas as fichas que JÁ têm `c2x_user_id` foram casadas
// exclusivamente pelo CPF/CNPJ, sem ninguém olhar se o par fecha — inclusive as reconciliadas em
// massa. Se alguma delas casou com a pessoa errada, o erro está lá, calado, desde então: o card
// mostra tudo certo e o vínculo aponta para outro cliente.
// Custa uma consulta ao C2X por blocos de 200 e roda com a MESMA função do servidor.
if (!semBanco && temIdNaFila.size > 0) {
  const ligadas = fila.filter((f) => f.c2x_user_id != null);

  // A fila tem linhas de entidades que não têm CAD na esteira (e que o servidor não listou). Sem
  // buscá-las, a auditoria as contaria como "não deu para comparar" — e um vínculo não conferido é
  // justamente o que esta seção existe para não deixar passar.
  const faltamNoMapa = [...new Set(ligadas.map((f) => f.entity_id))].filter(
    (id) => !porEntidade.has(id),
  );
  if (faltamNoMapa.length > 0) {
    const extras = await lerPorIds(
      "apolo_entities",
      "select=id,display_name,legal_name,document_masked,entity_kind," +
        "origem:metadata->>source,sincronizada:metadata->>c2xSynced," +
        "idNoMeta:metadata->>c2xUserId,papel:metadata->>bornRole",
      faltamNoMapa,
      "id",
    );
    for (const e of extras) porEntidade.set(e.id, e);
  }

  const nomesNoC2x = await nomesPorIdNoC2x(ligadas.map((f) => f.c2x_user_id));
  if (nomesNoC2x) {
    const divergentes = [];
    // Os pares que a régua APROVOU, guardados para a amostra. Sem eles, um relatório de "0
    // divergências" é indistinguível de um relatório que não comparou nada.
    const aprovados = [];
    let conferidas = 0;
    let semNomeNoApolo = 0;
    for (const f of ligadas) {
      const e = porEntidade.get(f.entity_id);
      // Ficha que não está no mapa (não tem CAD na esteira nem entrou na lista do servidor): sem os
      // nomes do Apolo não há o que comparar, e chamar isso de "confere" seria mentir na conta.
      if (!e) {
        semNomeNoApolo += 1;
        continue;
      }
      const r = confereNomeC2x(
        [e.display_name, e.legal_name],
        nomesNoC2x.get(Number(f.c2x_user_id)) ?? null,
      );
      if (r.confere) {
        conferidas += 1;
        aprovados.push({
          c2xUserId: f.c2x_user_id,
          documento: e.document_masked,
          nomeApolo: r.nomeApolo ?? e.display_name,
          nomeNoC2x: nomesNoC2x.get(Number(f.c2x_user_id)) ?? null,
          quando: f.atualizado_em ?? "",
          status: f.status,
        });
      } else {
        divergentes.push({
          c2xUserId: f.c2x_user_id,
          documento: e.document_masked,
          motivo: r.motivo,
          nomeApolo: r.nomeApolo ?? e.display_name,
          nomeNoC2x: nomesNoC2x.get(Number(f.c2x_user_id)) ?? null,
        });
      }
    }

    console.log(`\n── AUDITORIA das ${ligadas.length} fichas JÁ ligadas a um id do C2X ────────────`);
    console.log(`  nome confere ............................. ${conferidas}`);
    console.log(`  NOME DIVERGENTE (conferir a mão) ........ ${divergentes.length}`);
    if (semNomeNoApolo > 0) {
      console.log(`  sem nome no Apolo para comparar .......... ${semNomeNoApolo}`);
    }
    if (divergentes.length > 0) {
      console.log(`\n🔴 Estas já estão ligadas e o nome NÃO bate. Elas foram casadas só pelo`);
      console.log(`documento, antes desta conferência existir. Nenhuma é desfeita por este script:`);
      console.log(`desfazer vínculo de contrato é decisão de gente, não de lote.`);
      console.log(`  ${"NOME NO APOLO".padEnd(34)} | ${"NOME NO C2X".padEnd(34)} | id C2X | documento`);
      console.log(`  ${"-".repeat(34)} | ${"-".repeat(34)} | ------ | ---------`);
      for (const d of divergentes.slice(0, AMOSTRA)) {
        console.log(
          `  ${corta(d.nomeApolo, 34).padEnd(34)} | ${corta(d.nomeNoC2x ?? "(sem nome)", 34).padEnd(34)} | ` +
            `${String(d.c2xUserId).padStart(6)} | ${d.documento ?? ""}`,
        );
        console.log(`      ↳ ${corta(d.motivo, 100)}`);
      }
      if (divergentes.length > AMOSTRA) {
        console.log(`  · ... e mais ${divergentes.length - AMOSTRA} (use --tudo para ver todos)`);
      }
    }

    // AMOSTRA DO QUE A RÉGUA APROVOU — as reconciliações mais RECENTES feitas por máquina.
    // São elas que foram casadas só pelo documento, em lote, sem conferência de nome; se a régua
    // estivesse frouxa, é aqui que o erro apareceria. E é o par que o dono pede para ver antes de
    // autorizar qualquer gravação nova.
    const porMaquina = aprovados
      .filter((a) => a.status === "ja_no_c2x")
      .sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
    if (porMaquina.length > 0) {
      const quantas = Math.min(porMaquina.length, mostrarTudo ? porMaquina.length : 8);
      console.log(
        `\n  Amostra dos vínculos feitos por RECONCILIAÇÃO (${porMaquina.length} no total, ` +
          `${quantas} mais recentes) — é este par que a conferência olha:`,
      );
      console.log(`  ${"NOME NO APOLO".padEnd(34)} | ${"NOME NO C2X".padEnd(34)} | id C2X | documento`);
      console.log(`  ${"-".repeat(34)} | ${"-".repeat(34)} | ------ | ---------`);
      for (const a of porMaquina.slice(0, quantas)) {
        console.log(
          `  ${corta(a.nomeApolo, 34).padEnd(34)} | ${corta(a.nomeNoC2x ?? "(sem nome)", 34).padEnd(34)} | ` +
            `${String(a.c2xUserId).padStart(6)} | ${a.documento ?? ""}`,
        );
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 4. ENSAIO TERMINA AQUI
// ══════════════════════════════════════════════════════════════════════════════════════════════
if (!aplicar) {
  console.log(`\n── ENSAIO: NADA FOI GRAVADO ──`);
  console.log(
    `Reconciliaria agora: ${reconciliaveis.length}` +
      ` · ficariam de fora: ${suspeitos.length} suspeitos por divergência de nome`,
  );
  console.log(`\nConfira a amostra acima. Para gravar de verdade:`);
  console.log(`  node scripts/apolo/reconciliar-cads-c2x.mjs --aplicar`);
  process.exit(0);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 5. GRAVAÇÃO — só na NOSSA fila, e sem tocar o C2X
// ══════════════════════════════════════════════════════════════════════════════════════════════
console.log(`\nGravando a reconciliação de ${reconciliaveis.length} fichas...`);
const resultado = await chamarApp("/api/apolo/c2x-sync/lote", {
  apenasReconciliar: true,
  dryRun: false,
});
const itensDepois = resultado.itens ?? [];
const gravadas = itensDepois.filter((i) => i.status === "ja_no_c2x");
const falhas = itensDepois.filter((i) => i.status === "erro");

for (const i of gravadas.slice(0, AMOSTRA)) {
  console.log(`  [ok]   ${corta(i.nome, 40).padEnd(40)} id ${i.c2xUserId ?? "?"}`);
}
if (gravadas.length > AMOSTRA) console.log(`  · ... e mais ${gravadas.length - AMOSTRA}`);
for (const i of falhas) console.log(`  [ERRO] ${corta(i.nome, 40).padEnd(40)} ${corta(i.erro, 80)}`);

console.log(`\nReconciliadas: ${gravadas.length} · falhas: ${falhas.length}`);

// ── conferência: a fila mudou mesmo? ──────────────────────────────────────────────────────────
// O upsert do PostgREST falha em SILÊNCIO quando bate em NOT NULL sem default, então "a rota
// respondeu 200" não é prova de que a linha existe. A prova é reler a tabela.
const filaDepois = await lerPorIds(
  "apolo_c2x_sync",
  "select=entity_id,status,c2x_user_id",
  gravadas.map((i) => i.entityId),
);
const comId = filaDepois.filter((f) => f.c2x_user_id != null).length;
console.log(
  `Conferência na apolo_c2x_sync: ${comId} de ${gravadas.length} têm c2x_user_id gravado agora.`,
);
if (comId < gravadas.length) {
  console.log(`ATENÇÃO: ${gravadas.length - comId} não persistiram. Confira o log do servidor.`);
}
