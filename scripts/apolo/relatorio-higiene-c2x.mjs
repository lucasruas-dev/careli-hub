// RELATÓRIO DE HIGIENE DA BASE C2X — PDF interno para o time validar (pedido do Lucas, 02/08).
// Consolida a auditoria de 4 lentes (workflow wf_0a64f9d0-7b5): estado civil, pendências,
// pressa de 01/08 e duplicados. Cada item carrega a EVIDÊNCIA (C2X × ficha) — nada de palpite.
// Fontes: audit-pendencias-resultado.json (48 sem endereço) + o resultado do workflow.
//   node scripts/apolo/relatorio-higiene-c2x.mjs <caminho-do-output-do-workflow>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { PDFDocument, StandardFonts, rgb } = requireDoRepo("pdf-lib");

const outputWf = process.argv[2];
if (!outputWf) {
  console.error("uso: node relatorio-higiene-c2x.mjs <output-do-workflow>");
  process.exit(1);
}
const wf = JSON.parse(fs.readFileSync(outputWf, "utf8"));
const lentes = wf.result ?? wf;
const porLente = Object.fromEntries(
  lentes.map((l) => [
    /estado civil/i.test(l.lente) ? "civil"
      : /pend/i.test(l.lente) ? "pendencias"
      : /pressa|01\/08/i.test(l.lente) ? "pressa"
      : "dup",
    l,
  ]),
);
const auditPendencias = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "audit-pendencias-resultado.json"), "utf8"),
);
const semEndereco = auditPendencias.casos ?? [];

const fmtCpf = (c) => {
  const d = String(c ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : c;
};

// ── monta as seções ───────────────────────────────────────────────────────
const casosPressa = porLente.pressa?.casos ?? [];
const casosCivil = porLente.civil?.casos ?? [];
const casosDup = porLente.dup?.casos ?? [];

const secaoA = [
  ...casosDup.filter((c) => c.prioridade === "alta"),
  ...casosCivil,
  ...casosPressa.filter((c) => c.prioridade === "alta"),
  ...(porLente.pendencias?.casos ?? []).filter((c) => c.prioridade === "alta"),
  ...casosDup.filter((c) => c.prioridade !== "alta"),
];
const secaoTelefones = casosPressa.filter(
  (c) => c.prioridade === "media" && /telefone|celular/i.test(c.problema),
);
const secaoOutrosMedias = casosPressa.filter(
  (c) => c.prioridade === "media" && !/telefone|celular/i.test(c.problema),
);
const foraDoC2x = [
  { cpf: "126.743.146-64", nome: "PAULO VITOR ANDRADE SILVA" },
  { cpf: "050.145.106-47", nome: "MERCIA RAQUEL DA SILVA" },
  { cpf: "065.809.996-59", nome: "ELZA QUINTILIANO DE OLIVEIRA BARCELOS" },
  { cpf: "128.948.406-67", nome: "DOUGLAS RIBEIRO DOS SANTOS" },
  { cpf: "084.264.396-67", nome: "BEATRIZ RIBEIRO" },
];

// ── PDF ───────────────────────────────────────────────────────────────────
const pdf = await PDFDocument.create();
const fonte = await pdf.embedFont(StandardFonts.Helvetica);
const fonteBold = await pdf.embedFont(StandardFonts.HelveticaBold);
const LARG = 842, ALT = 595, MARGEM = 32;
const TINTA = rgb(0.1, 0.1, 0.12), FRACO = rgb(0.45, 0.45, 0.5), LINHA = rgb(0.86, 0.86, 0.88);
const ZEBRA = rgb(0.965, 0.965, 0.975), DOURADO = rgb(0.66, 0.53, 0.29), ALERTA = rgb(0.7, 0.2, 0.15);
const VERDE = rgb(0.24, 0.45, 0.2);

let pagina = null, y = 0;
const paginas = [];
const sanear = (t) =>
  String(t ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, (m) => m)
    .replace(/[×]/g, "x").replace(/[⁪⁫‪‬]/g, "").replace(/[^\x20-\xFFĀ-ſ]/g, "?");
const cortar = (t, larg, tam, f = fonte) => {
  let s = sanear(t);
  try { if (f.widthOfTextAtSize(s, tam) <= larg) return s; } catch { s = s.replace(/[^\x20-\x7E]/g, "?"); }
  while (s.length > 1 && f.widthOfTextAtSize(`${s}...`, tam) > larg) s = s.slice(0, -1);
  return `${s}...`;
};
const nova = () => {
  pagina = pdf.addPage([LARG, ALT]);
  paginas.push(pagina);
  pagina.drawText("HIGIENE DA BASE C2X · VALE DO OURO", { color: DOURADO, font: fonteBold, size: 9, x: MARGEM, y: ALT - 30 });
  pagina.drawText("Cadastros para o time validar — com a evidencia de cada um", { color: FRACO, font: fonte, size: 8.5, x: MARGEM, y: ALT - 42 });
  pagina.drawText("gerado em 02/08/2026 · uso interno (contem dados pessoais)", { color: FRACO, font: fonte, size: 8, x: LARG - MARGEM - 250, y: ALT - 30 });
  y = ALT - 62;
};
const titulo = (t, cor = TINTA) => {
  if (y < MARGEM + 60) nova();
  y -= 6;
  pagina.drawText(sanear(t), { color: cor, font: fonteBold, size: 12, x: MARGEM, y });
  y -= 8;
  pagina.drawLine({ color: LINHA, end: { x: LARG - MARGEM, y }, start: { x: MARGEM, y }, thickness: 0.8 });
  y -= 14;
};
const linhaCaso = (c, zebra) => {
  if (y < MARGEM + 30) nova();
  if (zebra) pagina.drawRectangle({ color: ZEBRA, height: 24, width: LARG - MARGEM * 2 + 8, x: MARGEM - 4, y: y - 15 });
  const cor = c.prioridade === "alta" ? ALERTA : TINTA;
  pagina.drawText(cortar(c.nome, 250, 8.5, fonteBold), { color: cor, font: fonteBold, size: 8.5, x: MARGEM, y });
  pagina.drawText(fmtCpf(c.cpf), { color: FRACO, font: fonte, size: 8, x: MARGEM + 262, y });
  pagina.drawText(cortar(c.problema, 420, 8.5), { color: TINTA, font: fonte, size: 8.5, x: MARGEM + 358, y });
  y -= 11;
  pagina.drawText(cortar(`Evidencia: ${c.evidencia}`, 740, 7.5), { color: FRACO, font: fonte, size: 7.5, x: MARGEM + 12, y });
  y -= 16;
};
const bullet = (t, cor = TINTA) => {
  if (y < MARGEM + 24) nova();
  pagina.drawText("•", { color: DOURADO, font: fonteBold, size: 9, x: MARGEM, y });
  pagina.drawText(cortar(t, 750, 8.5), { color: cor, font: fonte, size: 8.5, x: MARGEM + 12, y });
  y -= 13;
};

nova();
pagina.drawText("O RESUMO", { color: TINTA, font: fonteBold, size: 16, x: MARGEM, y });
y -= 24;
bullet("414 cadastros verificados no C2X (todos os que subiram do Apolo) — 365 estao completos e coerentes.");
bullet(`AGIR AGORA: ${secaoA.length} casos com evidencia forte (duplicatas de hoje, nascimento default, estado civil, e-mail trocado).`, ALERTA);
bullet(`PEDIR AO CLIENTE: ${semEndereco.length} subiram sem endereco (nao existe no C2X NEM na ficha — so o cliente tem).`);
bullet(`TELEFONES: ${secaoTelefones.length} numeros quebrados/repetidos para arrumar antes de disparos.`);
bullet(`FORA DO C2X: ${foraDoC2x.length} CADs de 01/08 que nao subiram (nao existem la).`);
bullet("VALIDAR NA ASSINATURA: 312 cadastros como solteiro(a) (76%) — a trava das certidoes fez o time subir casados como solteiros; nao ha rastro digital de quem: confirmar estado civil com a certidao no contrato.", ALERTA);
y -= 4;
pagina.drawText("O QUE ESTA LIMPO (conferido por SQL, para o time nao perder tempo):", { color: VERDE, font: fonteBold, size: 9.5, x: MARGEM, y });
y -= 14;
bullet("Zero CPF duplicado · zero e-mail duplicado entre pessoas · zero comprador sem imobiliaria · zero pedido duplicado da mesma unidade.", VERDE);
bullet("Naturalidade, nome da mae, documento, profissao, estado civil e nascimento: 100% preenchidos nos 414.", VERDE);
bullet("O numero que lembravamos (~88 pendencias) na verdade sao 49 por pessoa (a contagem antiga duplicava entidades-espelho).", VERDE);

titulo(`A · AGIR AGORA — ${secaoA.length} casos (corrigir no C2X hoje)`, ALERTA);
secaoA.forEach((c, i) => linhaCaso(c, i % 2 === 1));

titulo(`B · PEDIR AO CLIENTE — ${semEndereco.length} sem endereco em lugar nenhum`);
bullet("O motor nao tinha o que subir: a ficha do Apolo tambem esta sem endereco. Ligar/WhatsApp para completar antes do contrato.");
y -= 4;
semEndereco.forEach((c, i) => {
  if (y < MARGEM + 20) nova();
  if (i % 2 === 1) pagina.drawRectangle({ color: ZEBRA, height: 13, width: LARG - MARGEM * 2 + 8, x: MARGEM - 4, y: y - 4 });
  pagina.drawText(cortar(c.nome, 300, 8.5), { color: TINTA, font: fonte, size: 8.5, x: MARGEM, y });
  pagina.drawText(fmtCpf(c.cpf), { color: FRACO, font: fonte, size: 8, x: MARGEM + 312, y });
  pagina.drawText(`user C2X ${c.userId}`, { color: FRACO, font: fonte, size: 8, x: MARGEM + 420, y });
  y -= 13.5;
});

titulo(`C · TELEFONES PARA ARRUMAR — ${secaoTelefones.length} (antes de qualquer disparo)`);
secaoTelefones.forEach((c, i) => linhaCaso(c, i % 2 === 1));
if (secaoOutrosMedias.length) {
  y -= 4;
  secaoOutrosMedias.forEach((c, i) => linhaCaso(c, i % 2 === 1));
}

titulo(`D · FORA DO C2X — ${foraDoC2x.length} CADs de 01/08 que nao subiram`);
bullet("Nao existem no C2X (sem user com o CPF). Subir pelo lote assim que validadas — ou cadastrar na mao se a ficha estiver incompleta.");
y -= 4;
foraDoC2x.forEach((c, i) => {
  if (y < MARGEM + 20) nova();
  if (i % 2 === 1) pagina.drawRectangle({ color: ZEBRA, height: 13, width: LARG - MARGEM * 2 + 8, x: MARGEM - 4, y: y - 4 });
  pagina.drawText(cortar(c.nome, 320, 8.5), { color: TINTA, font: fonte, size: 8.5, x: MARGEM, y });
  pagina.drawText(c.cpf, { color: FRACO, font: fonte, size: 8, x: MARGEM + 332, y });
  y -= 13.5;
});

titulo("E · VALIDAR NA ASSINATURA (nao da para saber por sistema — o cartorio decide)", DOURADO);
bullet("ESTADO CIVIL: 312 de 412 subiram solteiros (76%). Quem e casado de verdade so aparece quando a certidao chegar na assinatura — orientar o time do contrato a CONFERIR SEMPRE e corrigir no C2X na hora.", ALERTA);
bullet("Escolaridade 'Medio Completo' em 68% dos cadastros: cheiro de opcao-padrao marcada na pressa. Confirmar junto quando falar com o cliente.");
bullet("Naturalidade 'Para de Minas' escrita de 3 jeitos (206 + 45 + 17): padronizar em lote depois da validacao.");
bullet("NIVEA CARELI com 15 pedidos vivos em 15 unidades (reservas seguradas da casa?) — conferir se e intencional.");

paginas.forEach((p, i) => {
  p.drawText(`Pagina ${i + 1} de ${paginas.length}`, { color: FRACO, font: fonte, size: 7.5, x: LARG - MARGEM - 62, y: MARGEM - 12 });
  p.drawText("Panteon · auditoria de 4 lentes · scripts reproduziveis em audit-*.mjs", { color: FRACO, font: fonte, size: 7.5, x: MARGEM, y: MARGEM - 12 });
});

const saida = path.join(process.env.USERPROFILE || ".", "Desktop", "VALIDACAO_BASE_C2X.pdf");
fs.writeFileSync(saida, await pdf.save());
console.log(`ok · paginas: ${paginas.length} · A:${secaoA.length} B:${semEndereco.length} C:${secaoTelefones.length + secaoOutrosMedias.length} D:${foraDoC2x.length}`);
console.log(saida);
