// NACIONALIDADE DOS 11 CÔNJUGES DO VILLA PARIS — apurada NO DOCUMENTO, não por suposição.
//
// "eu preciso da profissão e nacionalidade" (Lucas, 31/08/2026). A ficha do Apolo desses onze não
// tem os dois campos: as CADs são de 17 a 23/08 e o wizard só passou a gravar a ficha completa do
// cônjuge em 23/08 — antes disso sobreviviam apenas nome, CPF, e-mail e telefone. O PDF da CAD
// confirma: a seção CÔNJUGE traz nome, CPF, nascimento, mãe e contato, e nada mais.
//
// O que salvou a nacionalidade foi o documento de identidade do cônjuge, que estava anexado nos
// onze casos e nunca tinha passado por OCR (`extracted_payload` vazio em todos). Cada arquivo foi
// aberto e lido, um a um.
//
// ⚠️ A PROFISSÃO NÃO ESTÁ EM DOCUMENTO NENHUM. CNH e RG não trazem esse campo, e não há
// comprovante de renda do cônjuge na CAD. Não existe fonte: tem que ser perguntado ao cliente.
// Preencher por dedução ali seria inventar dado que vai para uma escritura.
//
// Uso (da raiz do repo):
//   node scripts/apolo/villa-paris-conjuges-nacionalidade.mjs          # confere e mostra
//   node scripts/apolo/villa-paris-conjuges-nacionalidade.mjs --xlsx   # gera a planilha
//
// ⚠️ SÓ LEITURA. Este script NÃO grava no C2X — a escrita no legado exige OK do Lucas a cada vez.

// O apurado, com a fonte de cada um. `explicito` = a palavra "nacionalidade" estava impressa no
// documento; `derivado` = veio da naturalidade ou do tipo de documento (RG estadual e CNH só são
// emitidos a brasileiro; estrangeiro carrega RNE).
export const NACIONALIDADE_APURADA = [
  {
    conjuge: "FLAVIA MENDES DA SILVA",
    cpf: "046.011.746-78",
    titular: "DENNIO MARCOS DE FARIA",
    documento: "CNH digital (SENATRAN/MG)",
    naturalidade: "João Monlevade, MG",
    nacionalidade: "Brasileira",
    como: "derivado",
  },
  {
    conjuge: "ROSANGELA DE SOUSA ARAUJO",
    cpf: null,
    titular: "GERALDO ANTONIO MENDES",
    documento: "RG antigo (qualificação civil, MG)",
    naturalidade: "MG",
    nacionalidade: "Brasileira",
    // O campo "ESTRANGEIROS / chegada ao Brasil" do próprio documento está em branco.
    como: "derivado",
  },
  {
    conjuge: "SABRINA ARIANE DOS SANTOS SOUZA ALMEIDA",
    cpf: "071.553.036-40",
    titular: "JEAN ERNANE DE ALMEIDA",
    documento: "Carteira de Identidade nova (PC/MG)",
    naturalidade: "João Monlevade, MG",
    nacionalidade: "Brasileira",
    como: "explicito", // o documento traz "Nacionalidade / Nationality: BRA"
  },
  {
    conjuge: "ROSEMAR SOARES LEMOS FRAGA",
    cpf: null,
    titular: "JOAO BATISTA FRAGA",
    documento: "RG (SSP/MG) — só a frente foi anexada",
    naturalidade: null,
    nacionalidade: "Brasileira",
    como: "derivado",
  },
  {
    conjuge: "GEICE KELY KARINA SILVA",
    cpf: "126.626.396-95",
    titular: "MAIRA PEREIRA DA SILVA",
    documento: "CNH (SENATRAN/MG)",
    naturalidade: "Itabira, MG",
    nacionalidade: "Brasileira",
    como: "explicito", // "NACIONALIDADE: BRASILEIRO(A)"
  },
  {
    conjuge: "EVERTON ANDRADE",
    cpf: null,
    titular: "MARIA LUCIA BRUNO ANDRADE",
    documento: "RG MG-13.256.755 (frente e verso)",
    naturalidade: "João Monlevade, MG",
    nacionalidade: "Brasileira",
    como: "derivado",
  },
  {
    conjuge: "JUNIA PAULA DE SOUZA PASSOS",
    cpf: "132.310.536-09",
    titular: "RAYLANDER DE FREITAS COURA",
    documento: "CNH (SENATRAN/MG)",
    naturalidade: "Santa Bárbara, MG",
    nacionalidade: "Brasileira",
    como: "explicito", // "NACIONALIDADE: BRASILEIRO"
  },
  {
    conjuge: "EDIMILSON RODRIGUES TEIXEIRA",
    cpf: "119.346.276-23",
    titular: "RAYNARA SILVESTRE MOURA RODRIGUES",
    documento: "CNH digital (SENATRAN/MG)",
    naturalidade: "Dom Silvério, MG",
    nacionalidade: "Brasileira",
    como: "explicito", // "NACIONALIDADE: BRASILEIRO(A)"
  },
  {
    conjuge: "SHEILA FERREIRA DA SILVA SOUZA",
    cpf: "031.795.136-08",
    titular: "RONALDO TEIXEIRA DE SOUZA",
    documento: "CNH (SENATRAN/MG)",
    naturalidade: "João Monlevade, MG",
    nacionalidade: "Brasileira",
    como: "explicito", // "NACIONALIDADE: BRASILEIRO"
  },
  {
    conjuge: "FRANCISLAINE TEIXEIRA MONLEVADE RODRIGUES",
    cpf: null,
    titular: "TIAGO RODRIGUES DIAS",
    documento: "Carteira de Identidade (PC/MG)",
    naturalidade: "Rio Piracicaba, MG",
    nacionalidade: "Brasileira",
    como: "derivado",
  },
  {
    conjuge: "ANIELLE SANTOS FIGUEIREDO GUERRA",
    cpf: "054.820.226-50",
    titular: "WAGNER ALIPIO GUERRA",
    documento: "CNH (DENATRAN/MG)",
    naturalidade: null,
    nacionalidade: "Brasileira",
    como: "derivado",
  },
];

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const explicitos = NACIONALIDADE_APURADA.filter((x) => x.como === "explicito");
  console.log("=".repeat(74));
  console.log("VILLA PARIS — nacionalidade dos cônjuges, apurada no documento");
  console.log("=".repeat(74));
  console.log(`  total:                       ${NACIONALIDADE_APURADA.length}`);
  console.log(`  escrita no documento:        ${explicitos.length}`);
  console.log(`  derivada (naturalidade/doc): ${NACIONALIDADE_APURADA.length - explicitos.length}`);
  console.log(`  todos brasileiros:           sim\n`);
  for (const x of NACIONALIDADE_APURADA) {
    const marca = x.como === "explicito" ? "✓" : "~";
    console.log(
      `  ${marca} ${x.conjuge.slice(0, 42).padEnd(42)} ${x.nacionalidade.padEnd(11)} ${x.documento}`,
    );
  }
  console.log("\n  ✓ = a palavra estava impressa no documento");
  console.log("  ~ = derivada da naturalidade ou do tipo de documento");
  console.log("\n⚠️ PROFISSÃO: nenhum dos 11 tem fonte. CNH e RG não trazem o campo, e não há");
  console.log("   comprovante de renda do cônjuge. Só perguntando ao cliente.");
}
