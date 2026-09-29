// O ENSAIO DE PARIDADE DA F4 (plano da fonte única, docs/assinatura/fonte-unica-do-contrato.md, "Trava
// da F4"): o leitor ANTIGO da aba Assinatura (C2X + D4Sign ao vivo + as nativas do Panteon, v1.389.0)
// contra a LEITURA ÚNICA (só o Panteon), por empreendimento e por categoria. A aba só troca de fonte com
// "inexplicado = 0".
//
//   node scripts/temis/comparar-leitura-de-assinaturas.mjs                 todos os códigos do catálogo e do cadastro
//   node scripts/temis/comparar-leitura-de-assinaturas.mjs --emp VOC,VOL   só esses
//   node scripts/temis/comparar-leitura-de-assinaturas.mjs --fixture       grava a saída anonimizada como fixture do vitest
//                                                                          (apps/hub/lib/assinatura/__fixtures__/paridade-das-leituras.json)
//
// ⚠️ SÓ LEITURA, NOS TRÊS LADOS. Supabase: só `select`. C2X: só `select`, as consultas próprias numa
// conexão com START TRANSACTION READ ONLY. D4Sign: o leitor antigo consulta como a tela faz (o catálogo,
// cacheado 5 min, e até 20 `/list` por carga); é o custo de uma abertura de tela por código.
//
// ⚠️ A COTA DA D4SIGN AINDA NÃO ESTÁ CONFIRMADA (pedido operacional da seção 9 do plano), e a conta é a
// MESMA que o C2X usa para mandar contrato. Então: rode com `--emp` em lotes pequenos; o primeiro 429
// PARA o laço (depois dele o leitor antigo cai no C2X cru por 10 min, e a comparação sairia
// contaminada); o código cujo quadro antigo veio degradado (`avisoDaFonte`) conta como FALHA; e o fim
// imprime quantas chamadas à D4Sign o ensaio fez (só o número; a URL leva a credencial e nunca sai).
//
// ⚠️ SÓ RODA COM A 0195 APLICADA E O ESPELHO CARREGADO (F3). Sem as views da 0195 o script para no
// começo, dizendo isso; sem o espelho, a comparação sai cheia de "inexplicado" (e está certa: a F4 não
// sobe assim).
//
// ⚠️ SEM DADO PESSOAL NA SAÍDA: contagens por empreendimento e categoria, e o CÓDIGO da unidade nos
// inexplicados. O documento do comprador só é lido para achar a mesma venda em duas glebas (0.30), SÓ
// das vendas cuja quadra e lote aparecem em mais de um empreendimento, em memória, e nunca é impresso.
// As credenciais vão do `.env.local` para `process.env` e não são impressas.
//
// ⚠️ A FIXTURE SÓ É GRAVADA COM O ENSAIO INTEIRO: com falha ou corte em algum código, o empreendimento
// sumiria dos DOIS lados e a trava ficaria verde sem ter comparado nada.
//
// ⚠️ A REGRA NÃO MORA AQUI: as duas leituras e a comparação são as do app (`jiti`, com o apelido `@`
// apontando para `apps/hub`, o padrão de `scripts/temis/espelhar-d4sign.mjs`).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const raiz = process.cwd();
const hub = path.resolve(raiz, "apps/hub");
const req = createRequire(path.resolve(hub, "package.json"));
const { createClient } = req("@supabase/supabase-js");
const { createJiti } = req("jiti");

const args = process.argv.slice(2);
const valorDe = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const gravarFixture = args.includes("--fixture");
const empPedidos = (valorDe("--emp") ?? "")
  .split(",")
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);

// O worktree pode não ter .env.local (não é versionado): cai no do checkout principal.
const ENV_LOCAL = [path.resolve(hub, ".env.local"), path.resolve(raiz, "../../careli-hub/apps/hub/.env.local")].find((p) =>
  fs.existsSync(p),
);
if (!ENV_LOCAL) {
  console.error("não achei apps/hub/.env.local");
  process.exit(2);
}
for (const linha of fs.readFileSync(ENV_LOCAL, "utf8").split("\n")) {
  if (!linha.includes("=") || linha.trim().startsWith("#")) continue;
  const i = linha.indexOf("=");
  const nome = linha.slice(0, i).trim();
  const valor = linha.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  if (nome && process.env[nome] === undefined) process.env[nome] = valor;
}

const jiti = createJiti(import.meta.url, { alias: { "@": hub } });
const importar = (arquivo) => jiti.import(path.resolve(hub, arquivo));
const { lerAssinaturasDoPanteon, lerAssinaturasDoPortal, unirComOPanteon } = await importar("lib/apolo/incorporador/assinaturas.ts");
const { lerContratosVivos } = await importar("lib/apolo/incorporador/contratos.ts");
const { idsDosCodigosNoCadastro } = await importar("lib/apolo/incorporador/escopo.ts");
const { catalogoDeEmpreendimentos } = await importar("lib/apolo/catalogo-empreendimentos.ts");
const { carregarCadastroDeEmpreendimentos } = await importar("lib/hercules/cadastro.ts");
const { lerContratosDoPanteon } = await importar("lib/assinatura/contratos-do-panteon.ts");
const { quadroDosContratos } = await importar("lib/assinatura/contratos-do-panteon-montagem.ts");
const { carregarCatalogoD4Sign, d4signRecusouPorCotaDesde } = await importar("lib/guardian/d4sign-consulta.ts");
const { compararLeituras, linhaAntiga, linhasNovas, totalInexplicado } = await importar("lib/assinatura/paridade-das-leituras.ts");
const { finalidadeDoTipoDoC2x } = await importar("lib/assinatura/espelho-d4sign/finalidade.ts");
const { parteDoLote } = await importar("lib/hercules/terreno.ts");
const { getHadesDbPool } = await importar("lib/guardian/db.ts");

const poolResult = getHadesDbPool();
if (!poolResult.ok) {
  console.error(`C2X sem configuração: ${poolResult.missing.join(", ")}`); // só os NOMES do que falta
  process.exit(2);
}
const pool = poolResult.pool;

// ⚠️ O CONTADOR DE CHAMADAS À D4SIGN. Conta pelo HOST e não guarda a URL: ela leva a credencial na
// query string (a regra de d4sign-consulta.ts), e nada dela pode ir para log nem para a saída.
let chamadasD4Sign = 0;
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (entrada, init) => {
  try {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (new URL(url).hostname.endsWith("d4sign.com.br")) chamadasD4Sign += 1;
  } catch {
    // URL ilegível: não conta, e o erro (que teria a URL) não sai.
  }
  return fetchOriginal(entrada, init);
};
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const LOTE = 100;
const PAGINA = 1000;

/** Paginado com ordem e `.in()` em lotes de 100 (as duas armadilhas do PostgREST da casa). */
async function lerEmLotes(valores, consulta) {
  const unicos = [...new Set(valores.map(String).filter(Boolean))];
  const linhas = [];
  for (let i = 0; i < unicos.length; i += LOTE) {
    const lote = unicos.slice(i, i + LOTE);
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await consulta(lote).range(de, de + PAGINA - 1);
      if (error) throw new Error(`${error.code ?? ""} ${error.message ?? ""}`.trim());
      linhas.push(...(data ?? []));
      if ((data ?? []).length < PAGINA) break;
    }
  }
  return linhas;
}

try {
  // 0. A 0195 está no banco? Sem as views, não há leitura única para comparar.
  const sonda = await admin.from("temis_contratos_do_panteon").select("proposta_id").limit(1);
  if (sonda.error) {
    console.error("a view temis_contratos_do_panteon não existe: a 0195 não está aplicada. Nada a comparar.");
    process.exit(2);
  }

  const agora = new Date();
  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  const cadastro = await carregarCadastroDeEmpreendimentos();
  const todos = [
    ...new Set([
      ...catalogo.flatMap((e) => e.codes),
      ...cadastro.filter((l) => l.c2xEnterpriseId && l.codigo).map((l) => l.codigo),
    ].map((c) => String(c).trim().toUpperCase()).filter(Boolean)),
  ].sort();
  const codigos = empPedidos.length > 0 ? todos.filter((c) => empPedidos.includes(c)) : todos;
  console.log(`ensaio de paridade: ${codigos.length} código(s)`);

  const antigas = [];
  const novas = [];
  const naoConferidas = {};
  const sumiramNoNovo = [];
  const cortados = [];
  const falhas = [];
  const tempoMedio = [];
  const idsDoC2x = new Set();
  const inicio = Date.now();
  let paradoPorCota = false;

  // ⚠️ O CATÁLOGO DA D4SIGN AQUECIDO UMA VEZ, ANTES DO LAÇO (29/09/2026). O leitor antigo roda com
  // `semEsperar: true`, como a tela: sem o catálogo em memória ele NÃO chama a D4Sign e volta
  // degradado (`avisoDaFonte`). Na tela o aquecimento acontece no `after()` da rota e a próxima
  // abertura já acha o catálogo quente; num processo isolado ele nunca aquece, e a primeira rodada do
  // ensaio (VOC, VOL, VOR) saiu 3 de 3 "antigo-degradado" com ZERO chamadas à D4Sign. Uma leitura do
  // catálogo (8 páginas) vale para o ensaio inteiro, no TTL de 5 min da lib.
  const catalogoQuente = await carregarCatalogoD4Sign();
  if (!catalogoQuente) {
    console.error("o catálogo da D4Sign não respondeu: sem ele o leitor antigo sai degradado e a comparação não vale.");
    process.exit(1);
  }

  for (const codigo of codigos) {
    const { ids } = idsDosCodigosNoCadastro(cadastro, catalogo, [codigo], null);
    for (const id of ids) if (/^\d+$/.test(id)) idsDoC2x.add(Number(id));

    // O catálogo vale 5 min e um código leva minutos no C2X: reaquece a cada código (no cache é de graça;
    // vencido, são as 8 páginas de novo). Sem isso o antigo esfria no meio e cai no C2X cru.
    await carregarCatalogoD4Sign();

    // O LEITOR ANTIGO, como a rota da v1.389.0 fazia.
    const [doLegado, doPanteon] = await Promise.all([lerAssinaturasDoPortal([codigo]), lerAssinaturasDoPanteon(admin, [codigo])]);
    if (d4signRecusouPorCotaDesde(inicio)) {
      // O primeiro 429 para tudo: o que vier depois compara contra um leitor antigo sem a D4Sign.
      falhas.push(`${codigo}:cota-da-d4sign`);
      paradoPorCota = true;
      break;
    }
    if (!doLegado.ok || !doPanteon.ok) {
      falhas.push(`${codigo}:antigo`);
      continue;
    }
    const quadroAntigo = unirComOPanteon(doLegado.data, doPanteon.linhas);
    if (quadroAntigo.aviso) cortados.push(codigo); // a lista antiga veio cortada no teto: a comparação é parcial
    // ⚠️ SÓ AS LINHAS QUE A D4SIGN NÃO CONFIRMOU FICAM DE FORA, E NOS DOIS LADOS (29/09/2026). O
    // `avisoDaFonte` acende se UM contrato do recorte caiu no registro do C2X (em movimento além do teto
    // de 20 `/list` por carga, ou documento que a D4Sign não achou naquela hora): descartar o
    // empreendimento inteiro por isso deixou VOC, VOL e VOR sem comparação nenhuma, duas vezes. A linha
    // antiga com envio e `fonte = 'c2x-legado'` é a não confirmada; ela e a linha nova da MESMA unidade
    // saem da conta e viram o número `naoConferidas`, que vai para a saída. Só se o antigo veio degradado
    // e não dá para apontar QUAIS linhas, o empreendimento inteiro continua sendo falha.
    const chaveDaLinha = (l) => `${String(l.empreendimento).trim().toUpperCase()}:${String(l.unidade).trim().toUpperCase()}`;
    const semConfirmacao = new Set(
      quadroAntigo.unidades.filter((u) => u.envioId !== 0 && u.fonte === "c2x-legado").map(chaveDaLinha),
    );
    if (quadroAntigo.avisoDaFonte && semConfirmacao.size === 0) {
      falhas.push(`${codigo}:antigo-degradado`);
      continue;
    }
    if (semConfirmacao.size > 0) naoConferidas[codigo] = semConfirmacao.size;
    antigas.push(...quadroAntigo.unidades.filter((u) => !semConfirmacao.has(chaveDaLinha(u))).map(linhaAntiga));

    // A LEITURA ÚNICA.
    const leitura = await lerContratosDoPanteon({ admin, agora, escopo: { enterpriseIds: ids } });
    if (!leitura.ok) {
      falhas.push(`${codigo}:novo`);
      continue;
    }
    const todasNovas = linhasNovas(leitura.contratos, agora);
    novas.push(...todasNovas.filter((l) => !semConfirmacao.has(chaveDaLinha(l))));
    // ⚠️ A NÃO CONFIRMADA AINDA TEM DE EXISTIR NO NOVO. Sem status para comparar, sobra a pergunta que
    // mais importa: o contrato sumiu? Unidade com envio no antigo e sem linha nenhuma no novo é inexplicado.
    const chavesNovas = new Set(todasNovas.map(chaveDaLinha));
    for (const chave of semConfirmacao) {
      if (!chavesNovas.has(chave)) sumiramNoNovo.push(chave);
    }
    // O tempo médio de assinatura dos dois lados (0.12: o novo perde amostra antiga; "gerado em" da carga
    // deixou de vir do histórico do C2X). Só números.
    tempoMedio.push({
      antigo: quadroAntigo.kpis.tempoMedioDias,
      codigo,
      novo: quadroDosContratos(leitura.contratos, { agora, interno: false }).kpis.tempoMedioDias,
    });
  }

  // OS FATOS: o que explica cada envio antigo sem par, os AR vivos no C2X e a venda só no C2X.
  const envios = new Map();
  const conexao = await pool.getConnection();
  let vivos = [];
  try {
    await conexao.query("START TRANSACTION READ ONLY");
    const csIds = [...new Set(antigas.map((a) => a.envioId).filter((id) => id > 0))];
    const unidadesDoC2x = new Map();
    for (let i = 0; i < csIds.length; i += 500) {
      const lote = csIds.slice(i, i + 500);
      const [linhas] = await conexao.query(
        `select cs.id as cs_id, nullif(trim(cs.uuidDoc), '') as uuid_doc, cs.contract_signature_status_id as status,
                cs.contract_type as tipo, ar.enterprise_unity_id as unidade, ar.id as ar_id
           from contract_signatures cs
           join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
           join acquisition_requests ar on ar.id = arc.acquisition_request_id
          where cs.id in (?)`,
        [lote],
      );
      for (const l of linhas) {
        unidadesDoC2x.set(Number(l.cs_id), Number(l.unidade));
        envios.set(Number(l.cs_id), {
          arId: Number.isInteger(Number(l.ar_id)) && Number(l.ar_id) > 0 ? Number(l.ar_id) : null,
          semUuid: !l.uuid_doc,
          status6: Number(l.status) === 6,
          tipoNaoMapeado: finalidadeDoTipoDoC2x(l.tipo) === null,
          unidadeForaDoPanteon: false,
        });
      }
    }
    await conexao.query("COMMIT");
    const noPanteon = new Set(
      (
        await lerEmLotes([...new Set(unidadesDoC2x.values())], (lote) =>
          admin.from("hercules_unidades").select("origem_c2x_id").in("origem_c2x_id", lote).order("origem_c2x_id", { ascending: true }),
        )
      ).map((l) => Number(l.origem_c2x_id)),
    );
    for (const [csId, unidade] of unidadesDoC2x) {
      const fato = envios.get(csId);
      if (fato) fato.unidadeForaDoPanteon = !noPanteon.has(unidade);
    }
    vivos = await lerContratosVivos(pool, [...idsDoC2x]);
  } finally {
    conexao.release();
  }

  const arsVivosNoC2x = new Set(vivos.map((v) => v.arId));
  const arsNoPanteon = new Set(
    (
      await lerEmLotes(vivos.map((v) => v.arId), (lote) =>
        admin.from("hercules_propostas").select("origem_c2x_id").in("origem_c2x_id", lote).order("origem_c2x_id", { ascending: true }),
      )
    ).map((l) => Number(l.origem_c2x_id)),
  );
  // O rótulo da linha antiga: `coalesce(nullif(trim(name), ''), code + block + lot)`.
  const chavesSoNoC2x = new Set(
    vivos
      .filter((v) => !arsNoPanteon.has(v.arId))
      .map((v) => `${v.enterpriseCode.toUpperCase()}:${(v.unitName || `${v.enterpriseCode}${v.bloco ?? ""}${v.lote ?? ""}`).toUpperCase()}`),
  );

  // A MESMA VENDA EM DUAS GLEBAS (0.30): mesma pessoa, mesma quadra e lote, empreendimentos diferentes.
  //
  // ⚠️ EM DUAS ETAPAS, PARA O DOCUMENTO SÓ SER LIDO DE QUEM PODE SER CASO (revisão da F4). Primeiro, sem
  // dado pessoal, a quadra e o lote de cada venda da carga: só a chave que aparece em MAIS DE UM
  // empreendimento é candidata (a 0.30 mediu dezenas de casos, contra ~2.400 vendas). Depois, o
  // documento SÓ dessas propostas, reduzido aos dígitos, em memória, e nunca sai.
  const daCarga = novas.filter((n) => n.origemDaVenda === "c2x" && n.propostaId);
  const propostasDaCarga = await lerEmLotes(daCarga.map((n) => n.propostaId), (lote) =>
    admin.from("hercules_propostas").select("id,unidade_id").in("id", lote).order("id", { ascending: true }),
  );
  const unidadesDaCarga = await lerEmLotes(propostasDaCarga.map((d) => d.unidade_id), (lote) =>
    admin.from("hercules_unidades").select("id,enterprise_id,quadra,lote").in("id", lote).order("id", { ascending: true }),
  );
  const unidadePorId = new Map(unidadesDaCarga.map((u) => [u.id, u]));
  const chaveDoLote = (u) => `${parteDoLote(u.quadra)}|${parteDoLote(u.lote)}`;
  const empreendimentosPorLote = new Map();
  for (const p of propostasDaCarga) {
    const u = unidadePorId.get(p.unidade_id);
    if (!u) continue;
    const lista = empreendimentosPorLote.get(chaveDoLote(u)) ?? new Set();
    lista.add(String(u.enterprise_id));
    empreendimentosPorLote.set(chaveDoLote(u), lista);
  }
  const candidatas = propostasDaCarga.filter((p) => {
    const u = unidadePorId.get(p.unidade_id);
    return u && (empreendimentosPorLote.get(chaveDoLote(u))?.size ?? 0) > 1;
  });
  const docs = await lerEmLotes(candidatas.map((p) => p.id), (lote) =>
    admin.from("hercules_propostas").select("id,cliente_documento,unidade_id").in("id", lote).order("id", { ascending: true }),
  );
  const porPessoaELote = new Map();
  for (const d of docs) {
    const u = unidadePorId.get(d.unidade_id);
    const digitos = String(d.cliente_documento ?? "").replace(/\D/g, "");
    if (!u || !digitos) continue;
    const chave = `${digitos}|${chaveDoLote(u)}`;
    const lista = porPessoaELote.get(chave) ?? [];
    lista.push({ enterprise: String(u.enterprise_id), id: d.id });
    porPessoaELote.set(chave, lista);
  }
  const duplicatasDeGleba = new Set();
  for (const lista of porPessoaELote.values()) {
    if (new Set(lista.map((l) => l.enterprise)).size > 1) for (const l of lista) duplicatasDeGleba.add(l.id);
  }
  porPessoaELote.clear();
  docs.length = 0;

  const relatorio = compararLeituras(antigas, novas, { arsVivosNoC2x, chavesSoNoC2x, duplicatasDeGleba, envios });
  const saida = {
    chamadasD4Sign,
    codigos: codigos.length,
    cortadosNoTetoAntigo: cortados,
    falhas,
    geradoEm: agora.toISOString(),
    inexplicado: totalInexplicado(relatorio) + sumiramNoNovo.length,
    // Unidades que a D4Sign não confirmou no leitor antigo, fora da comparação nos dois lados.
    naoConferidas,
    // Dessas, as que não têm linha nenhuma no novo (só código de unidade).
    sumiramNoNovo,
    paradoPorCota,
    tempoMedio,
    ...relatorio,
  };
  console.log(JSON.stringify(saida, null, 2));
  console.log(`chamadas à D4Sign neste ensaio: ${chamadasD4Sign}`);

  if (gravarFixture) {
    if (falhas.length > 0 || cortados.length > 0) {
      // ⚠️ Não grava: a fixture de um ensaio incompleto seria uma trava verde sobre o que não se comparou.
      console.error(`fixture NÃO gravada: ${falhas.length} falha(s) e ${cortados.length} código(s) cortado(s) no teto antigo`);
    } else {
      const destino = path.resolve(hub, "lib/assinatura/__fixtures__/paridade-das-leituras.json");
      fs.writeFileSync(destino, `${JSON.stringify(saida, null, 2)}\n`);
      console.log(`fixture gravada: ${path.relative(raiz, destino)}`);
    }
  }
  if (saida.inexplicado > 0 || falhas.length > 0 || cortados.length > 0) process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
// ⚠️ O PROCESSO TERMINA AQUI: um socket da D4Sign ou do Supabase aberto deixava o node pendurado depois
// do relatório (29/09/2026, a segunda rodada saiu por timeout com a saída já impressa).
process.exit(process.exitCode ?? 0);
