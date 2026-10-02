// CARREGA OS CLIENTES DA CECÍLIO ROCHA NO APOLO, COM O PAPEL "COMPRADOR CECÍLIO".
//
// Uso (da raiz do repositório):
//   node scripts/apolo/importar-compradores-cecilio.mjs                       (ensaio: lê, mostra, não grava)
//   node scripts/apolo/importar-compradores-cecilio.mjs --gravar              (grava)
//   node scripts/apolo/importar-compradores-cecilio.mjs --desfazer            (ensaio do desfazer)
//   node scripts/apolo/importar-compradores-cecilio.mjs --desfazer --gravar   (desfaz)
// Opções: --env=<arquivo .env.local>   --saida=<planilha .xlsx de conferência>
//
// Lucas, 02/10/2026: *"vamos criar dentro do apolo um perfil comprador cecilio e vamos cria-los com os
// dados que temos. (...) O principal objetivo é o time conseguir fazer contato para realizar cobrança."*
//
// ⛔ GRAVAR EM PRODUÇÃO EXIGE OK EXPLÍCITO DO LUCAS, A CADA VEZ. E SÓ DEPOIS DE NO AR:
//   • a migration 0209 (sem ela o papel 'comprador_cecilio' recusa no CHECK);
//   • o código da mesma branch: a trava da Cacá (cliente da Cecílio vai direto para um analista) mora
//     nele. Sem ela, a Cacá confirmaria a identidade pelo CPF e responderia "sem carteira" a quem deve.
//
// AS REGRAS ESTÃO EM apps/hub/lib/apolo/carga-comprador-cecilio.ts, com teste. Este arquivo só lê o
// banco, chama `montarPlano`, mostra o resultado e grava. A regra é compilada na hora (esbuild), como em
// scripts/boletos/padronizar-telefones.mjs: uma segunda cópia aqui divergiria da testada.
//
// ⚠️ O TERMINAL SÓ MOSTRA CONTAGENS E EXEMPLOS MASCARADOS. Nome, CPF e telefone vão para a planilha de
// conferência (--saida, fora do repositório), que é para o Lucas e não se commita.
//
// ⚠️ PostgREST corta em 1.000 linhas sem erro (toda leitura pagina, com ordem) e `.in()` com muitos ids
// estoura a URL (lotes de 100). O `error` de TODA escrita é conferido, e a carga para no primeiro.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hub = path.resolve(raiz, "apps/hub");
const req = createRequire(path.resolve(hub, "package.json"));
const { createClient } = req("@supabase/supabase-js");
const esbuild = req("esbuild");
const ExcelJS = req("exceljs");

const argumento = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3) ?? null;
const gravar = process.argv.includes("--gravar");
const desfazer = process.argv.includes("--desfazer");
const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

// ─── as regras, compiladas do código testado ───────────────────────────────────────────────────
const compilado = await esbuild.build({
  bundle: true,
  format: "esm",
  platform: "node",
  stdin: {
    contents: `export * from "./lib/apolo/carga-comprador-cecilio";
export { EMPREENDIMENTOS_DE_BOLETO } from "./lib/apolo/boletos/empreendimentos";`,
    loader: "ts",
    resolveDir: hub,
  },
  tsconfig: path.resolve(hub, "tsconfig.json"),
  write: false,
});
const R = await import(`data:text/javascript;base64,${Buffer.from(compilado.outputFiles[0].text).toString("base64")}`);

// O escopo decidido pelo Lucas em 02/10/2026: as 9 carteiras de boleto mais o Vale do Ouro 2. Ficam fora
// "A classificar", Mirage e Manhattan.
const SLUGS_DO_ESCOPO = [
  "garden", "vale-do-sol", "on-sky", "guaimbe", "giant-towers",
  "ed-rubi", "ed-jade", "ed-cristal", "ed-esmeralda", "vale-do-ouro-2",
];
const escopo = SLUGS_DO_ESCOPO.map((slug) => {
  const e = R.EMPREENDIMENTOS_DE_BOLETO.find((x) => x.slug === slug);
  if (!e) throw new Error(`Carteira ${slug} não existe em lib/apolo/boletos/empreendimentos.ts`);
  return { chaveLsoft: e.chaveLsoft ?? e.nome, nome: e.nome, slug };
});

// ─── conexão ────────────────────────────────────────────────────────────────────────────────────
const arquivoEnv = argumento("env") ?? path.resolve(hub, ".env.local");
if (!fs.existsSync(arquivoEnv)) {
  console.error(`Não achei ${arquivoEnv}. Num worktree, aponte o do checkout principal: --env=<caminho>/apps/hub/.env.local`);
  process.exit(1);
}
const env = Object.fromEntries(
  fs
    .readFileSync(arquivoEnv, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── leitura ────────────────────────────────────────────────────────────────────────────────────
// ⚠️ A ORDEM TEM DE SER ÚNICA: com uma coluna que se repete (a view da carteira tem uma linha por cliente
// E empreendimento), a paginação por faixa pode pular ou repetir linhas na virada da página, sem erro.
async function lerTudo(tabela, colunas, ordem, filtro = (q) => q) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    let consulta = filtro(sb.from(tabela).select(colunas));
    for (const coluna of [].concat(ordem)) consulta = consulta.order(coluna);
    const { data, error } = await consulta.range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...data);
    if (data.length < 1000) return linhas;
  }
}

async function emLotes(valores, consulta) {
  const linhas = [];
  for (let i = 0; i < valores.length; i += 100) {
    const lote = valores.slice(i, i + 100);
    if (!lote.length) continue;
    const { data, error } = await consulta(lote);
    if (error) throw new Error(error.message);
    linhas.push(...(data ?? []));
  }
  return linhas;
}

function falhou(onde, error) {
  if (!error) return;
  console.error(`\n❌ ${onde}: ${error.message}\nA carga PAROU aqui. O que já foi gravado fica; rodar de novo retoma (o plano pula o que já existe).`);
  process.exit(1);
}

// ─── desfazer ───────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ SÓ O QUE A CARGA GRAVOU, E NUNCA POR CIMA DO TRABALHO DO TIME. Apagar a ficha leva junto, por
// cascata, tudo o que pende dela. Por isso a ficha que ganhou QUALQUER linha fora da carga (nota,
// documento, vínculo, esteira, consulta, contato digitado à mão) não é apagada nem tocada: ela vai
// para a lista, e o Lucas decide. As fontes também são filtradas pela etiqueta, para uma carga futura
// da Cecílio não ir junto.
if (desfazer) {
  const etiqueta = R.ETIQUETA_DA_CARGA;
  const novas = await lerTudo("apolo_entities", "id,metadata", "id", (q) => q.eq("metadata->>carga", etiqueta).eq("metadata->>source", "cecilio"));
  // ⚠️ O "não é ficha nova" é filtrado AQUI, e não com `.neq` no banco: a ficha que já existia não tem
  // `metadata.carga`, e `NULL <> 'x'` é NULL no SQL — o `.neq` devolveria zero e ninguém seria limpo.
  const idsNovos = new Set(novas.map((f) => f.id));
  const tocadas = (await lerTudo("apolo_entities", "id,metadata", "id", (q) => q.eq("metadata->cecilio->>carga", etiqueta))).filter((f) => !idsNovos.has(f.id));

  // As 27 ligações de `apolo_entities` medidas em 02/10/2026 (pg_constraint). As 4 primeiras a carga
  // também grava: nelas só conta como trabalho do time a linha SEM a etiqueta.
  const COM_ETIQUETA = ["apolo_addresses", "apolo_contacts", "apolo_entity_identifiers", "apolo_entity_profiles"];
  const SEM_ETIQUETA = [
    ["apolo_audit_events", "entity_id"], ["apolo_c2x_sync", "entity_id"], ["apolo_commercial_links", "entity_id"],
    ["apolo_credito_overrides", "entity_id"], ["apolo_documents", "entity_id"], ["apolo_enterprise_settings", "vendedor_entity_id"],
    ["apolo_esteira", "entity_id"], ["apolo_esteira", "corretor_entity_id"], ["apolo_esteira", "imobiliaria_entity_id"],
    ["apolo_financial_snapshots", "entity_id"], ["apolo_imobiliaria_match", "entity_id"], ["apolo_merge_candidates", "entity_id"],
    ["apolo_merge_candidates", "candidate_entity_id"], ["apolo_module_records", "entity_id"], ["apolo_relationships", "entity_id"],
    ["apolo_relationships", "related_entity_id"], ["apolo_service_signals", "entity_id"], ["apolo_timeline_events", "entity_id"],
    ["hercules_documentos", "cliente_entity_id"], ["serasa_consultas", "entity_id"], ["temis_categorias", "vendedor_entity_id"],
  ];
  const comTrabalho = new Set();
  const idsNovosLista = [...idsNovos];
  for (const [tabela, coluna] of SEM_ETIQUETA) {
    for (const linha of await emLotes(idsNovosLista, (lote) => sb.from(tabela).select(coluna).in(coluna, lote))) comTrabalho.add(linha[coluna]);
  }
  for (const tabela of COM_ETIQUETA) {
    for (const linha of await emLotes(idsNovosLista, (lote) => sb.from(tabela).select("entity_id,metadata").in("entity_id", lote))) {
      if (linha.metadata?.carga !== etiqueta) comTrabalho.add(linha.entity_id);
    }
  }
  const apagar = novas.filter((f) => !comTrabalho.has(f.id));
  const alvo = [...apagar.map((f) => f.id), ...tocadas.map((f) => f.id)];

  const ETIQUETADAS = {
    apolo_addresses: (q) => q.eq("metadata->>carga", etiqueta),
    apolo_contacts: (q) => q.eq("metadata->>carga", etiqueta),
    apolo_entity_identifiers: (q) => q.eq("source_system", "cecilio").eq("metadata->>carga", etiqueta),
    apolo_entity_profiles: (q) => q.eq("profile", "comprador_cecilio").eq("metadata->>carga", etiqueta),
    apolo_source_links: (q) => q.eq("source_system", "cecilio").eq("metadata->>carga", etiqueta),
  };
  console.log(`DESFAZER a carga "${etiqueta}"`);
  console.log(`  ${apagar.length} fichas criadas pela carga: apagadas inteiras`);
  console.log(`  ${comTrabalho.size} fichas criadas pela carga em que o time JÁ TRABALHOU: NÃO são tocadas (lista abaixo, para decidir)`);
  for (const id of comTrabalho) console.log(`     ${id}`);
  console.log(`  ${tocadas.length} fichas que já existiam: perdem só o que a carga acrescentou`);
  for (const [tabela, filtro] of Object.entries(ETIQUETADAS)) {
    const linhas = await emLotes(alvo, (lote) => filtro(sb.from(tabela).select("entity_id")).in("entity_id", lote));
    console.log(`     ${tabela}: ${linhas.length} linhas com a etiqueta`);
  }
  if (!gravar) {
    console.log("\nENSAIO do desfazer: nada foi apagado. Rode com --desfazer --gravar para valer (com o OK do Lucas).");
    process.exit(0);
  }
  for (const [tabela, filtro] of Object.entries(ETIQUETADAS)) {
    for (let i = 0; i < alvo.length; i += 100) {
      const { error } = await filtro(sb.from(tabela).delete()).in("entity_id", alvo.slice(i, i + 100));
      falhou(`apagar ${tabela}`, error);
    }
  }
  for (let i = 0; i < apagar.length; i += 100) {
    const { error } = await sb.from("apolo_entities").delete().in("id", apagar.slice(i, i + 100).map((f) => f.id)).eq("metadata->>carga", etiqueta);
    falhou("apagar fichas novas", error);
  }
  for (const ficha of tocadas) {
    const { cecilio, ...resto } = ficha.metadata ?? {};
    const { error } = await sb.from("apolo_entities").update({ metadata: resto }).eq("id", ficha.id);
    falhou(`limpar metadata de ${ficha.id}`, error);
  }
  console.log(`\n✓ Desfeito: ${apagar.length} fichas apagadas, ${tocadas.length} devolvidas ao que eram, ${comTrabalho.size} preservadas para decisão.`);
  process.exit(0);
}

// ─── prova de que o id determinístico é o do servidor, contra uma ficha REAL do C2X ─────────────
{
  const { data, error } = await sb.from("apolo_source_links").select("entity_id,source_id").eq("source_system", "c2x").eq("source_table", "users").limit(1);
  if (error || !data?.[0]) throw new Error(`Sem ficha do C2X para conferir o id determinístico: ${error?.message ?? "vazio"}`);
  if (R.uuidDeterministico(`apolo:c2x:users:${data[0].source_id}`) !== data[0].entity_id) {
    throw new Error("O id determinístico da carga NÃO bate com o do servidor. Nada foi gravado.");
  }
}

console.log("Lendo boletos, LSoft e Apolo (só leitura)...");
const boletos = await lerTudo("boletos_documentos", "id,empreendimento,unidade,documento,nome,contato", "id", (q) => q.eq("workspace_id", "careli"));
const clientesLsoft = await lerTudo(
  "lsoft_clientes",
  "codigo,nome,cpf,rg,nascimento,telefone,celular,email,endereco,numero,complemento,bairro,cidade,estado,cep,mae,pai,nome_pai,sexo,estado_civil,regime_bens,escolaridade,profissao,naturalidade,nacionalidade,faixa_renda,conjuge",
  "codigo",
);
const carteirasLsoft = await lerTudo("lsoft_carteira_por_cliente_empreendimento", "codigo,empreendimento,parcelas_abertas", ["codigo", "empreendimento"]);

// Telefones que já receberam o boleto com entrega confirmada pelo WhatsApp (delivered/read).
const envios = await lerTudo("boletos_eventos", "id,empreendimento,telefone,wa_message_id", "id", (q) => q.eq("tipo", "envio").eq("ok", true));
const entregas = await emLotes(
  [...new Set(envios.map((e) => e.wa_message_id).filter(Boolean))],
  (lote) => sb.from("caredesk_whatsapp_message_refs").select("wa_message_id,delivery_status").in("wa_message_id", lote),
);
const entregue = new Set(entregas.filter((r) => ["delivered", "read"].includes(r.delivery_status)).map((r) => r.wa_message_id));
const telefonesEntregues = new Set(
  envios
    .filter((e) => !String(e.empreendimento).startsWith("teste") && entregue.has(e.wa_message_id))
    .map((e) => R.lerContato(e.telefone))
    .filter((c) => c.tipo === "telefone")
    .map((c) => c.normalizado),
);

// As fichas que já existem, por documento, nas DUAS pernas (como `fichasDoDocumento`).
const documentos = [
  ...new Set(
    [...boletos.map((b) => b.documento), ...clientesLsoft.map((c) => c.cpf)]
      .map(R.soDigitos)
      .filter((d) => R.tipoDoDocumento(d)),
  ),
];
const docPorHash = new Map(documentos.map((d) => [R.hashDoIdentificador(R.tipoDoDocumento(d), d), d]));
const hashesDeDoc = [...docPorHash.keys()];
const porIdentificador = await emLotes(hashesDeDoc, (lote) =>
  sb.from("apolo_entity_identifiers").select("entity_id,value_hash").in("identifier_type", ["cpf", "cnpj"]).in("value_hash", lote),
);
const porColuna = await emLotes(hashesDeDoc, (lote) => sb.from("apolo_entities").select("id,document_hash").in("document_hash", lote));
const idsPorDoc = new Map();
for (const { entity_id: id, value_hash: h } of porIdentificador) idsPorDoc.set(docPorHash.get(h), new Set([...(idsPorDoc.get(docPorHash.get(h)) ?? []), id]));
for (const { id, document_hash: h } of porColuna) idsPorDoc.set(docPorHash.get(h), new Set([...(idsPorDoc.get(docPorHash.get(h)) ?? []), id]));
const idsDeFicha = [...new Set([...idsPorDoc.values()].flatMap((s) => [...s]))];
const entidades = await emLotes(idsDeFicha, (lote) => sb.from("apolo_entities").select("id,status,display_name,metadata").in("id", lote));
const perfis = await emLotes(idsDeFicha, (lote) => sb.from("apolo_entity_profiles").select("entity_id,profile").in("entity_id", lote));
const contatosGravados = await emLotes(idsDeFicha, (lote) => sb.from("apolo_contacts").select("entity_id,contact_type,normalized_value,value").in("entity_id", lote));
const idsGravados = await emLotes(idsDeFicha, (lote) => sb.from("apolo_entity_identifiers").select("entity_id,identifier_type,value_hash").in("entity_id", lote));
const enderecos = await emLotes(idsDeFicha, (lote) => sb.from("apolo_addresses").select("entity_id").in("entity_id", lote));
const fichasPorDocumento = new Map();
for (const [doc, ids] of idsPorDoc) {
  const fichas = [...ids]
    .map((id) => entidades.find((e) => e.id === id))
    .filter((e) => e && e.status !== "archived")
    .map((e) => ({
      contatos: contatosGravados.filter((c) => c.entity_id === e.id),
      displayName: e.display_name,
      id: e.id,
      identificadores: idsGravados.filter((i) => i.entity_id === e.id),
      metadata: e.metadata,
      perfis: perfis.filter((p) => p.entity_id === e.id).map((p) => p.profile),
      status: e.status,
      temEndereco: enderecos.some((x) => x.entity_id === e.id),
    }));
  if (fichas.length) fichasPorDocumento.set(doc, fichas);
}

// Telefones e e-mails candidatos que já são identificador de alguma ficha (em qualquer forma do número).
const candidatos = [
  ...boletos.map((b) => b.contato),
  ...clientesLsoft.flatMap((c) => [c.celular, c.telefone, c.email]),
].map(R.lerContato);
const hashesDeContato = [
  ...new Set(
    candidatos.flatMap((c) =>
      c.tipo === "telefone"
        ? R.variantesDoTelefone(c.normalizado).map((v) => R.hashDoIdentificador("phone", v))
        : c.tipo === "email"
          ? [R.hashDoIdentificador("email", c.valor)]
          : [],
    ),
  ),
];
const existentes = await emLotes(hashesDeContato, (lote) =>
  sb.from("apolo_entity_identifiers").select("entity_id,value_hash").in("identifier_type", ["phone", "email"]).in("value_hash", lote),
);
const identificadoresExistentes = new Map();
for (const { entity_id: id, value_hash: h } of existentes) identificadoresExistentes.set(h, (identificadoresExistentes.get(h) ?? new Set()).add(id));

// Fontes da Cecílio já gravadas: uma que aponte para OUTRA ficha que não a do plano é conflito.
const fontesGravadas = await lerTudo("apolo_source_links", "entity_id,source_table,source_id", "id", (q) => q.eq("source_system", "cecilio"));

// ─── o plano ────────────────────────────────────────────────────────────────────────────────────
const plano = R.montarPlano({
  boletos,
  carteirasLsoft,
  clientesLsoft,
  data: hoje,
  escopo,
  fichasPorDocumento,
  identificadoresExistentes,
  telefonesEntregues,
});
const conflitosDeFonte = [];
for (const p of plano.pessoas) {
  for (const f of p.fontes) {
    const gravada = fontesGravadas.find((g) => g.source_table === f.source_table && g.source_id === f.source_id);
    if (gravada && gravada.entity_id !== p.entityId) conflitosDeFonte.push({ documento: p.documento, fonte: `${f.source_table}:${f.source_id}`, ficha: gravada.entity_id });
  }
}
const comConflito = new Set(conflitosDeFonte.map((c) => c.documento));
const pessoas = plano.pessoas.filter((p) => !comConflito.has(p.documento));

// ─── o relatório ────────────────────────────────────────────────────────────────────────────────
const mascararDoc = (d) => (d.length === 11 ? `***.***.***-${d.slice(-2)}` : `**.***.***/****-${d.slice(-2)}`);
const mascararNome = (n) => String(n ?? "").split(/\s+/).filter(Boolean).map((p) => `${p[0]}***`).join(" ");
const conta = (lista, f) => lista.filter(f).length;
const contatos = pessoas.flatMap((p) => p.contatos);
const L = plano.listas;

console.log(`\nESCOPO: ${escopo.map((c) => c.nome).join(", ")}`);
console.log(`\nPESSOAS NA CARGA: ${pessoas.length}`);
console.log(`  ${conta(pessoas, (p) => p.acao === "nova")} fichas NOVAS`);
console.log(`  ${conta(pessoas, (p) => p.acao === "reaproveitar")} fichas que JÁ EXISTEM (ganham só o papel, os contatos que faltam e a fonte)`);
console.log(`  ${conta(pessoas, (p) => p.acao === "ja-carregada")} já carregadas antes (a carga só completa)`);
console.log(`  ${conta(pessoas, (p) => p.kind === "pf")} pessoas físicas · ${conta(pessoas, (p) => p.kind === "pj")} jurídicas`);
console.log(`  ${conta(pessoas, (p) => p.fontes.some((f) => f.source_table === "boletos_documentos") && p.fontes.some((f) => f.source_table === "lsoft_clientes"))} no boleto e no LSoft · ${conta(pessoas, (p) => !p.fontes.some((f) => f.source_table === "lsoft_clientes"))} só no boleto · ${conta(pessoas, (p) => !p.fontes.some((f) => f.source_table === "boletos_documentos"))} só no LSoft`);
console.log(`  ${conta(pessoas, (p) => p.unidades.length > 1)} com 2 ou mais unidades · ${conta(pessoas, (p) => p.carteiras.length > 1)} em 2 ou mais carteiras`);
console.log(`  ${conta(pessoas, (p) => p.contatos.some((c) => c.tipo !== "email")) } com telefone novo · ${conta(pessoas, (p) => p.acao === "nova" && !p.contatos.length)} fichas novas SEM nenhum contato`);
console.log("\nPOR CARTEIRA (pessoas):");
for (const c of escopo) console.log(`  ${c.nome.padEnd(18)} ${conta(pessoas, (p) => p.carteiras.includes(c.nome))}`);
console.log("\nCONTATOS A GRAVAR:");
for (const tipo of ["whatsapp", "phone", "email"]) {
  const t = contatos.filter((c) => c.tipo === tipo);
  console.log(`  ${tipo.padEnd(9)} ${String(t.length).padStart(4)}  (verified ${conta(t, (c) => c.status === "verified")}, pending ${conta(t, (c) => c.status === "pending")}, attention ${conta(t, (c) => c.status === "attention")})`);
}
const ids = pessoas.flatMap((p) => p.identificadores);
console.log(`\nIDENTIFICADORES: ${["cpf", "cnpj", "phone", "email", "legacy_id"].map((t) => `${t} ${conta(ids, (i) => i.identifier_type === t)}`).join(" · ")}`);
console.log(`ENDEREÇOS: ${conta(pessoas, (p) => p.endereco)}   FONTES: ${pessoas.flatMap((p) => p.fontes).length}`);

console.log("\nLISTAS DE CONFERÊNCIA (fora da carga ou com contato em atenção):");
console.log(`  ${L.cruzados.length} pares CRUZADOS (boleto e LSoft trocam os titulares): FORA da carga`);
for (const c of L.cruzados) console.log(`     ${c.carteiras.join("/")}: ${c.documentos.map(mascararDoc).join(" <-> ")}`);
console.log(`  ${L.nomeDiferente.length} documentos com o primeiro nome diferente entre boleto e LSoft (${conta(L.nomeDiferente, (n) => n.kind === "pj")} PJ; ${conta(L.nomeDiferente, (n) => n.kind === "pf" && n.grafia)} PF só de grafia; ${conta(L.nomeDiferente, (n) => n.kind === "pf" && !n.grafia)} PF com nome diferente: telefone do boleto em atenção)`);
for (const n of L.nomeDiferente.slice(0, 3)) console.log(`     ex.: ${mascararDoc(n.documento)}  boleto "${mascararNome(n.nomeBoleto)}"  LSoft "${mascararNome(n.nomeLsoft)}"`);
console.log(`  ${L.fichasAmbiguas.length} documentos com mais de uma ficha ativa no Apolo: FORA`);
console.log(`  ${conflitosDeFonte.length} fontes já ligadas a outra ficha: FORA (${comConflito.size} pessoas)`);
console.log(`  ${L.semDocumento.length} clientes do LSoft sem CPF/CNPJ válido, com parcela aberta no escopo: FORA`);
console.log(`  ${L.documentoInvalido.length} linhas de boleto com documento inválido: FORA`);
console.log(`  ${L.unidadeComCodigo.length} linhas de boleto com o código do LSoft no lugar da unidade: ignoradas`);
console.log(`  ${L.telefonesCompartilhados.length} telefones compartilhados (${new Set(L.telefonesCompartilhados.flatMap((t) => t.documentos)).size} documentos; ${conta(L.telefonesCompartilhados, (t) => t.outrasFichas.length)} já são de outra ficha do Apolo): gravados em atenção, sem identificador`);
console.log(`  ${L.emailsCompartilhados.length} e-mails compartilhados: sem identificador`);
console.log(`  ${L.recados.length} recados no lugar do contato · ${L.telefoneNaoReconhecido.length} telefones não reconhecidos: não viram contato`);

// ─── a planilha de conferência (fora do repositório: tem nome, CPF e telefone) ─────────────────
const saida = argumento("saida") ?? path.join(os.homedir(), "Downloads", `conferencia-comprador-cecilio-${hoje}.xlsx`);
const livro = new ExcelJS.Workbook();
const aba = (nome, colunas, linhas) => {
  const s = livro.addWorksheet(nome);
  s.columns = colunas.map((c) => ({ header: c, key: c, width: Math.max(14, c.length + 4) }));
  for (const l of linhas) s.addRow(l);
  s.getRow(1).font = { bold: true };
};
const nomeDoDoc = (d) => pessoas.find((p) => p.documento === d)?.nome ?? clientesLsoft.find((c) => R.soDigitos(c.cpf) === d)?.nome ?? boletos.find((b) => R.soDigitos(b.documento) === d)?.nome ?? "";
aba("Carga", ["acao", "documento", "nome", "tipo", "carteiras", "unidades", "contatos", "em_atencao"], pessoas.map((p) => ({
  acao: p.acao, carteiras: p.carteiras.join(", "), contatos: p.contatos.map((c) => `${c.tipo}:${c.valor}:${c.status}`).join(" | "),
  documento: R.documentoFormatado(p.documento), em_atencao: p.contatos.some((c) => c.status === "attention") ? "sim" : "",
  nome: p.nome, tipo: p.kind, unidades: p.unidades.map((u) => (u.unidade ? `${u.carteira} ${u.unidade}` : u.carteira)).join(", "),
})));
aba("Cruzados", ["documento", "nome_no_lsoft", "carteiras"], L.cruzados.flatMap((c) => c.documentos.map((d) => ({ carteiras: c.carteiras.join(", "), documento: R.documentoFormatado(d), nome_no_lsoft: nomeDoDoc(d) }))));
aba("Nome diferente", ["documento", "tipo", "so_grafia", "nome_boleto", "nome_lsoft"], L.nomeDiferente.map((n) => ({ documento: R.documentoFormatado(n.documento), nome_boleto: n.nomeBoleto, nome_lsoft: n.nomeLsoft, so_grafia: n.grafia ? "sim" : "", tipo: n.kind })));
aba("Telefone compartilhado", ["telefone", "documentos", "nomes", "ja_e_de_outra_ficha"], L.telefonesCompartilhados.map((t) => ({ documentos: t.documentos.map(R.documentoFormatado).join(", "), ja_e_de_outra_ficha: t.outrasFichas.length ? "sim" : "", nomes: t.documentos.map(nomeDoDoc).join(" | "), telefone: t.telefone })));
aba("E-mail compartilhado", ["email", "documentos", "nomes"], L.emailsCompartilhados.map((e) => ({ documentos: e.documentos.map(R.documentoFormatado).join(", "), email: e.email, nomes: e.documentos.map(nomeDoDoc).join(" | ") })));
aba("Sem documento", ["codigo_lsoft", "nome", "carteiras"], L.semDocumento.map((s) => ({ carteiras: s.carteiras.join(", "), codigo_lsoft: s.codigo, nome: s.nome })));
aba("Documento invalido", ["carteira", "unidade", "nome"], L.documentoInvalido);
aba("Fichas ambiguas", ["documento", "nome", "fichas"], L.fichasAmbiguas.map((f) => ({ documento: R.documentoFormatado(f.documento), fichas: f.fichas.join(", "), nome: nomeDoDoc(f.documento) })));
aba("Fonte em outra ficha", ["documento", "fonte", "ficha"], conflitosDeFonte.map((c) => ({ ...c, documento: R.documentoFormatado(c.documento) })));
aba("Contato descartado", ["documento", "origem", "valor"], [
  ...L.recados.map((r) => ({ documento: "", origem: `recado ${r.carteira} ${r.unidade ?? ""}`, valor: "(recado no campo contato)" })),
  ...L.telefoneNaoReconhecido.map((t) => ({ documento: R.documentoFormatado(t.documento), origem: t.origem, valor: t.valor })),
]);
fs.mkdirSync(path.dirname(saida), { recursive: true });
await livro.xlsx.writeFile(saida);
console.log(`\nPlanilha de conferência (com nomes e documentos, NÃO commitar): ${saida}`);

if (!gravar) {
  console.log("\nENSAIO: nada foi gravado. Rode com --gravar para valer (só com o OK do Lucas e o código da Fase 1 no ar).");
  process.exit(0);
}

// ─── gravação ───────────────────────────────────────────────────────────────────────────────────
const etiqueta = { carga: R.ETIQUETA_DA_CARGA };
let feitas = 0;
for (const p of pessoas) {
  if (p.acao === "nova") {
    falhou(`ficha ${mascararDoc(p.documento)}`, (await sb.from("apolo_entities").insert(R.linhaDaFichaNova(p, hoje))).error);
  } else {
    // Ficha que já existe: só `metadata.cecilio` muda, e por LEITURA + MESCLA. Nome, status, os outros
    // papéis e o que veio do C2X ficam como estão.
    const { data: atual, error } = await sb.from("apolo_entities").select("metadata").eq("id", p.entityId).single();
    falhou(`ler ficha ${mascararDoc(p.documento)}`, error);
    const metadata = { ...(atual?.metadata ?? {}), cecilio: R.metadataCecilio(p, hoje) };
    falhou(`metadata ${mascararDoc(p.documento)}`, (await sb.from("apolo_entities").update({ metadata }).eq("id", p.entityId)).error);
  }

  const linhasDePerfil = R.perfisDaPessoa(p).map((profile) => ({ entity_id: p.entityId, metadata: etiqueta, profile, status: "active" }));
  falhou(`papéis ${mascararDoc(p.documento)}`, (await sb.from("apolo_entity_profiles").upsert(linhasDePerfil, { ignoreDuplicates: true, onConflict: "entity_id,profile" })).error);

  if (p.identificadores.length) {
    const linhas = p.identificadores.map((i) => ({ ...i, entity_id: p.entityId, metadata: etiqueta, source_system: "cecilio" }));
    falhou(`identificadores ${mascararDoc(p.documento)}`, (await sb.from("apolo_entity_identifiers").upsert(linhas, { ignoreDuplicates: true, onConflict: "entity_id,identifier_type,value_hash" })).error);
  }

  if (p.contatos.length) {
    const linhas = p.contatos.map((c) => ({
      contact_type: c.tipo, entity_id: p.entityId, is_primary: c.primario, label: c.label,
      metadata: { ...etiqueta, compartilhado: c.compartilhado, origem: c.origem, source: "cecilio" },
      normalized_value: c.normalizado, status: c.status, value: c.valor,
    }));
    falhou(`contatos ${mascararDoc(p.documento)}`, (await sb.from("apolo_contacts").insert(linhas)).error);
  }

  if (p.endereco) {
    const linha = { ...p.endereco, country: "BR", entity_id: p.entityId, is_primary: true, label: "Principal", metadata: { ...etiqueta, source: "cecilio" }, status: "pending" };
    falhou(`endereço ${mascararDoc(p.documento)}`, (await sb.from("apolo_addresses").insert(linha)).error);
  }

  const fontes = p.fontes.map((f) => ({ ...f, entity_id: p.entityId, last_seen_at: new Date().toISOString(), source_system: "cecilio" }));
  falhou(`fontes ${mascararDoc(p.documento)}`, (await sb.from("apolo_source_links").upsert(fontes, { ignoreDuplicates: true, onConflict: "source_system,source_table,source_id" })).error);

  // O índice de busca só nas fichas DA CARGA. Na ficha que já existia ele não é reescrito: ela já é
  // achada por nome, documento e telefone, e no espelho do C2X o sync reimprime esta linha de qualquer jeito.
  if (p.acao !== "reaproveitar") {
    falhou(`busca ${mascararDoc(p.documento)}`, (await sb.from("apolo_search_entries").upsert(R.linhaDeBusca(p), { onConflict: "entity_id" })).error);
  }

  feitas += 1;
  process.stdout.write(`\r  ${feitas}/${pessoas.length}`);
}
console.log(`\n\n✓ ${feitas} pessoas gravadas com o papel "Comprador Cecílio".`);
