// A PORTA QUE O SCRIPT DE CARGA USA — as mesmas funções que a tela e a rota usam, sem cópia.
//
// ⚠️ EXISTE PARA O SCRIPT NÃO TER A PRÓPRIA REGRA. `scripts/boletos/carregar-parcelas.mjs` decide
// quem emite e quem fica de fora; se ele reimplementasse essa decisão, a tela diria 11 boletos e o
// banco teria 12, e o décimo segundo só apareceria no extrato de um cliente que não devia ter sido
// cobrado. O script compila este arquivo com esbuild e importa daqui.
//
// ⚠️ NÃO ACRESCENTE LÓGICA AQUI. É só reexportação: qualquer coisa escrita neste arquivo passa a ser
// código que só o script executa, e código que só o script executa é código que ninguém testa.

export { valorDaCelula } from "./celula-do-excel";
export { empreendimentoDaAba, empreendimentoPorSlug } from "./empreendimentos";
export { lerAba, linhaDoCliente } from "./ler-planilha";
export { vereditoDaLinha } from "./regra-de-emissao";
