// Levanta as CADs que NÃO subiram para o C2X e gera uma folha de trabalho em HTML para o time
// validar. Só LEITURA: não escreve nada, em lugar nenhum.
//
// Uso (da raiz do repo):
//   node scripts/apolo/cads-nao-subiram.mjs
//
// Sai em: CADS_PENDENTES_C2X.html (na Área de Trabalho)
//
// Os grupos saem na ordem em que o time consegue resolver:
//   1. CONFERIR      — importação e ficha discordam sobre a mãe ou o nascimento. É o rastro da CAD
//                      montada com os dados do cônjuge, e esses campos vão no contrato.
//   2. FALTA CAMPO   — dado declaratório que nenhuma base pública responde (escolaridade, regime).
//   3. SEM VÍNCULO   — a ficha tem o NOME da imobiliária, mas falta ligar na entidade dela.
import fs from "node:fs";
import path from "node:path";

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

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em apps/hub/.env.local");
  process.exit(1);
}

const ler = async (tabela, query) => {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${await resp.text()}`);
  return resp.json();
};

// Mesma normalização da cascata (lib/apolo/cadastro-cascata.ts): caixa e acento não são
// divergência; grafia partida pelo OCR é.
const chave = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

const texto = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

console.log("Lendo o Apolo...");

const entidades = await ler(
  "apolo_entities",
  "select=id,display_name,document_masked,metadata&entity_kind=eq.pf&metadata->>source=eq.apolo",
);
const pendentes = entidades.filter(
  (e) => e.metadata?.cadastro && e.metadata?.c2xSynced !== true,
);
const ids = pendentes.map((e) => e.id);

// Em blocos de 100: `in` com centenas de uuids estoura a URL do PostgREST.
const emBlocos = async (tabela, query, coluna = "entity_id") => {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const bloco = ids.slice(i, i + 100);
    out.push(...(await ler(tabela, `${query}&${coluna}=in.(${bloco.join(",")})`)));
  }
  return out;
};

const esteiras = await emBlocos(
  "apolo_esteira",
  "select=entity_id,ficha,imobiliaria,corretor,etapa,empreendimento",
);
const vinculos = await emBlocos(
  "apolo_relationships",
  "select=entity_id&related_entity_id=not.is.null&relationship_type=ilike.imobili*&status=neq.archived",
);
// Quem JÁ foi enviada e a API recusou: aqui mora a mensagem que o C2X devolveu.
const tentativas = await emBlocos("apolo_c2x_sync", "select=entity_id,status,erro,requisicao");

const porEntidade = new Map(esteiras.map((e) => [e.entity_id, e]));
const temVinculo = new Set(vinculos.map((v) => v.entity_id));
const porTentativa = new Map(tentativas.map((t) => [t.entity_id, t]));

const OBRIGATORIOS = [
  ["estadoCivilId", "Estado civil"],
  ["escolaridadeId", "Escolaridade"],
  ["rendaId", "Renda"],
  ["naturalidade", "Naturalidade"],
  ["nomeMae", "Nome da mãe"],
  ["dataNascimento", "Nascimento"],
];

const linhas = pendentes.map((ent) => {
  const es = porEntidade.get(ent.id) ?? {};
  const cad = ent.metadata?.cadastro ?? {};
  const fic = es.ficha ?? {};
  const valor = (k) => texto(fic[k]) ?? texto(cad[k]);

  const faltam = OBRIGATORIOS.filter(([k]) => !valor(k)).map(([, rotulo]) => rotulo);
  const civil = valor("estadoCivilId");
  if ((civil === "2" || civil === "6") && !valor("regimeBensId")) faltam.push("Regime de bens");

  const maeImp = texto(cad.nomeMae);
  const maeFic = texto(fic.nomeMae);
  const nascImp = texto(cad.dataNascimento);
  const nascFic = texto(fic.dataNascimento);
  const divergencias = [];
  if (maeImp && maeFic && chave(maeImp) !== chave(maeFic)) divergencias.push("nome da mãe");
  if (nascImp && nascFic && nascImp !== nascFic) divergencias.push("data de nascimento");

  const tent = porTentativa.get(ent.id);
  const recusada = tent && tent.status !== "resolvido" ? tent : null;

  return {
    corretor: es.corretor ?? "",
    cpf: ent.document_masked ?? "",
    divergencias,
    emailEnviado: recusada?.requisicao?.email ?? null,
    etapa: es.etapa ?? "",
    faltam,
    imobiliaria: es.imobiliaria ?? "",
    maeFic,
    maeImp,
    nascFic,
    nascImp,
    nome: ent.display_name ?? "",
    recusaDaApi: recusada?.erro ?? null,
    semVinculo: !temVinculo.has(ent.id),
  };
});

// A recusa da API vem PRIMEIRO: é o motivo mais concreto e o mais fácil de resolver.
const recusadas = linhas.filter((l) => l.recusaDaApi);
const resto = linhas.filter((l) => !l.recusaDaApi);
const conferir = resto.filter((l) => l.divergencias.length > 0);
const faltaCampo = resto.filter((l) => l.divergencias.length === 0 && l.faltam.length > 0);
const semVinculo = resto.filter(
  (l) => l.divergencias.length === 0 && l.faltam.length === 0 && l.semVinculo,
);
const semMotivo = resto.filter(
  (l) => l.divergencias.length === 0 && l.faltam.length === 0 && !l.semVinculo,
);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const porImobiliaria = (lista) => {
  const mapa = new Map();
  for (const l of lista) {
    const k = l.imobiliaria || "(sem imobiliária na ficha)";
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(l);
  }
  return [...mapa.entries()].sort((a, b) => b[1].length - a[1].length);
};

const bloco = (titulo, explicacao, acao, lista, render) => {
  if (lista.length === 0) return "";
  const grupos = porImobiliaria(lista)
    .map(
      ([imob, itens]) => `
      <div class="grupo">
        <h3>${esc(imob)} <span class="qtd">${itens.length}</span></h3>
        ${itens.map(render).join("")}
      </div>`,
    )
    .join("");
  return `
  <section>
    <div class="cabeca">
      <h2>${esc(titulo)} <span class="total">${lista.length}</span></h2>
      <p class="expl">${explicacao}</p>
      <p class="acao"><strong>O que fazer:</strong> ${acao}</p>
    </div>
    ${grupos}
  </section>`;
};

const linhaBase = (l) => `
  <label class="item">
    <input type="checkbox" />
    <span class="nome">${esc(l.nome)}</span>
    <span class="cpf">${esc(l.cpf)}</span>
    <span class="meta">${esc(l.corretor)}${l.etapa ? ` · ${esc(l.etapa)}` : ""}</span>
  </label>`;

const html = `<title>CADs que não subiram para o C2X</title>
<style>
  :root {
    --tinta: #1a1a1a; --fraco: #6b6b6b; --linha: #e2e0dc; --fundo: #faf9f7;
    --papel: #fff; --alerta: #a4381f; --atencao: #8a6218; --calmo: #2f5d50;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--fundo); color: var(--tinta); margin: 0;
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 32px 20px 64px;
  }
  .folha { margin: 0 auto; max-width: 940px; }
  header { border-bottom: 2px solid var(--tinta); margin-bottom: 28px; padding-bottom: 18px; }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin: 0 0 6px; }
  .sub { color: var(--fraco); margin: 0; }
  .resumo { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
  .kpi {
    background: var(--papel); border: 1px solid var(--linha); border-radius: 8px;
    min-width: 130px; padding: 10px 14px;
  }
  .kpi b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }
  .kpi span { color: var(--fraco); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  section { margin-top: 36px; }
  .cabeca { border-left: 3px solid var(--tinta); padding-left: 14px; }
  h2 { font-size: 19px; margin: 0 0 4px; }
  .total {
    background: var(--tinta); border-radius: 20px; color: var(--papel);
    font-size: 13px; padding: 1px 10px; vertical-align: 3px;
  }
  .expl { color: var(--fraco); margin: 0 0 6px; }
  .acao { margin: 0; }
  .grupo { margin-top: 18px; }
  .grupo h3 {
    border-bottom: 1px solid var(--linha); font-size: 14px; letter-spacing: .04em;
    margin: 0 0 8px; padding-bottom: 5px; text-transform: uppercase;
  }
  .qtd { color: var(--fraco); font-weight: 400; }
  .item {
    align-items: baseline; background: var(--papel); border: 1px solid var(--linha);
    border-radius: 7px; display: flex; flex-wrap: wrap; gap: 10px;
    margin-bottom: 6px; padding: 9px 12px;
  }
  .item input { margin: 0; }
  .nome { font-weight: 600; }
  .cpf { color: var(--fraco); font-variant-numeric: tabular-nums; }
  .meta { color: var(--fraco); font-size: 13px; margin-left: auto; }
  .falta { color: var(--atencao); font-size: 13px; width: 100%; }
  .lados { display: grid; gap: 8px; grid-template-columns: 1fr 1fr; margin-top: 6px; width: 100%; }
  .lado { background: var(--fundo); border-radius: 6px; font-size: 13px; padding: 7px 10px; }
  .lado b { display: block; color: var(--fraco); font-size: 11px; letter-spacing: .05em;
            margin-bottom: 2px; text-transform: uppercase; }
  .alvo { color: var(--alerta); font-size: 13px; width: 100%; }
  @media (max-width: 620px) { .lados { grid-template-columns: 1fr; } .meta { margin-left: 0; } }
  @media print {
    body { background: #fff; padding: 0; }
    .item, .kpi { break-inside: avoid; }
    section { break-before: page; }
  }
</style>
<div class="folha">
  <header>
    <h1>CADs que não subiram para o C2X</h1>
    <p class="sub">Vale do Ouro · levantado em ${new Date().toLocaleString("pt-BR")}</p>
    <div class="resumo">
      <div class="kpi"><b>${linhas.length}</b><span>Não subiram</span></div>
      <div class="kpi"><b>${recusadas.length}</b><span>Recusadas</span></div>
      <div class="kpi"><b>${conferir.length}</b><span>Conferir</span></div>
      <div class="kpi"><b>${faltaCampo.length}</b><span>Falta campo</span></div>
      <div class="kpi"><b>${semVinculo.length}</b><span>Sem vínculo</span></div>
    </div>
  </header>

  ${bloco(
    "Recusadas pelo C2X",
    "Foram enviadas e a API recusou. O motivo dela vem abaixo de cada nome, junto com o valor que saiu daqui.",
    "corrigir o dado apontado na ficha do CRM e enviar de novo pela tela Sync C2X. A maioria é erro de digitação no e-mail: espaço no meio, vírgula no lugar do ponto, arroba dobrada, acento, ou o endereço sem o domínio.",
    recusadas,
    (l) => `
    <label class="item">
      <input type="checkbox" />
      <span class="nome">${esc(l.nome)}</span>
      <span class="cpf">${esc(l.cpf)}</span>
      <span class="meta">${esc(l.corretor)}</span>
      <span class="alvo">${esc(l.recusaDaApi)}</span>
      ${l.emailEnviado ? `<div class="lado" style="width:100%"><b>Valor que saiu daqui</b>${esc(l.emailEnviado)}</div>` : ""}
    </label>`,
  )}

  ${bloco(
    "Conferir na CAD",
    "A importação do Asana e a ficha do operador discordam sobre quem é a pessoa. É o rastro conhecido da CAD montada com os dados do cônjuge, quando a leitura do documento parou no anexo errado.",
    "abrir a CAD original e decidir qual dos dois lados é o titular. Estes campos vão no contrato, então ninguém deve escolher no chute.",
    conferir,
    (l) => `
    <label class="item">
      <input type="checkbox" />
      <span class="nome">${esc(l.nome)}</span>
      <span class="cpf">${esc(l.cpf)}</span>
      <span class="meta">${esc(l.corretor)}</span>
      <span class="alvo">Não bate: ${esc(l.divergencias.join(" e "))}</span>
      <div class="lados">
        <div class="lado"><b>Veio da importação</b>${esc(l.maeImp ?? "—")}${l.nascImp ? ` · ${esc(l.nascImp)}` : ""}</div>
        <div class="lado"><b>Está na ficha</b>${esc(l.maeFic ?? "—")}${l.nascFic ? ` · ${esc(l.nascFic)}` : ""}</div>
      </div>
    </label>`,
  )}

  ${bloco(
    "Falta campo obrigatório",
    "Dados que o C2X exige e que nenhuma base pública responde: escolaridade e regime de bens são declarados pela pessoa, e regime de bens sai da certidão de casamento.",
    "pedir ao corretor ou ao cliente, e preencher pela edição da ficha no CRM.",
    faltaCampo,
    (l) => `
    <label class="item">
      <input type="checkbox" />
      <span class="nome">${esc(l.nome)}</span>
      <span class="cpf">${esc(l.cpf)}</span>
      <span class="meta">${esc(l.corretor)}</span>
      <span class="falta">Falta: ${esc(l.faltam.join(", "))}</span>
    </label>`,
  )}

  ${bloco(
    "Sem vínculo de imobiliária",
    "A ficha tem o NOME da imobiliária, mas ela não está ligada à entidade dela no CRM. O C2X pede o id da imobiliária, não o nome, então sem esse elo o cadastro não sobe.",
    "conferir de qual imobiliária é a ficha e criar o vínculo no CRM. Se a imobiliária não existir como cadastro, ela precisa ser criada antes.",
    semVinculo,
    linhaBase,
  )}

  ${bloco(
    "Sem motivo aparente",
    "Passaram em todas as checagens e ainda não foram enviadas. Provavelmente é só rodar o envio de novo.",
    "abrir a tela Sync C2X, clicar em Diagnosticar e depois em Enviar.",
    semMotivo,
    linhaBase,
  )}
</div>`;

const destino = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  "Desktop",
  "CADS_PENDENTES_C2X.html",
);
fs.writeFileSync(destino, html, "utf8");

console.log(`\nNão subiram: ${linhas.length}`);
console.log(`  Recusadas pelo C2X ..... ${recusadas.length}`);
console.log(`  Conferir na CAD ........ ${conferir.length}`);
console.log(`  Falta campo ............ ${faltaCampo.length}`);
console.log(`  Sem vínculo ............ ${semVinculo.length}`);
console.log(`  Sem motivo aparente .... ${semMotivo.length}`);
console.log(`\nArquivo: ${destino}`);
