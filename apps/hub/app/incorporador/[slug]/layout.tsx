import { ehPortalPersonalizado } from "@/lib/apolo/incorporador/perfis-de-portal";
import { scriptDeTemaAntesDaPintura } from "@/lib/apolo/incorporador/tema-portal";

// A CASCA DO PORTAL — existe por UMA razão: pintar o tema escolhido ANTES da tela aparecer.
//
// Pedido do Lucas (18/08/2026): *"um detalhe, temos que disponibilizar o dark também"*. O alternador
// guarda a escolha no localStorage, que só existe no navegador — o servidor renderiza a página sem
// saber dela. Se a aplicação esperasse o React montar para aplicar o tema, quem escolheu o escuro
// abriria o portal e veria a tela CLARA inteira por um quadro antes de virar. É o "piscar branco"
// clássico, e num portal que o cliente abre de manhã cedo ele é bem visível.
//
// A saída é a que o repo já usa quando precisa rodar algo antes do resto da página: um
// `<script dangerouslySetInnerHTML>` no começo do corpo, o mesmo mecanismo do sinal de gravação do
// Chronos em `app/layout.tsx`. O navegador executa o script ENQUANTO lê o HTML, então o atributo
// `data-inc-tema` já está no <html> quando o CSS do tema (modules/incorporador/tema) é aplicado.
//
// ⚠️ POR QUE UM LAYOUT E NÃO A PÁGINA. O layout renderiza ANTES da página na mesma resposta: o
// script sai no HTML acima de tudo o que o portal desenha. Dentro da página ele viria depois do
// que já estivesse pintado, que é justamente o que se quer evitar.
//
// ⚠️ NADA DE `suppressHydrationWarning` AQUI. O script mexe no <html>, que já é
// `suppressHydrationWarning` no layout raiz, e em nenhum nó desta árvore — o React nunca vê
// diferença entre o que o servidor mandou e o que ele encontrou. O estado do alternador (qual dos
// três botões está aceso) começa em "seguir o aparelho" no servidor E no cliente, e só se ajusta
// depois do mount: hidratação idêntica dos dois lados, sem tapa-buraco.
export default async function LayoutIncorporador({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // ⚠️ TODO PORTAL RECEBE O SCRIPT, inclusive o personalizado — o Lucas liberou a escolha para o
  // Cecílio em 18/08/2026 ("pode deixar a Cecílio escolher também"). O que muda entre os dois é só
  // o PADRÃO de quem nunca escolheu: escuro no padrão, aparelho no personalizado, para o portal
  // que já está no ar não trocar de cara sozinho. Ver [[perfis-de-portal]].
  const padrao = ehPortalPersonalizado(slug) ? "sistema" : undefined;

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: scriptDeTemaAntesDaPintura(padrao) }} />
      {children}
    </>
  );
}
