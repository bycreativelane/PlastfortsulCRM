import { DocsShell } from '@/components/docs/docs-shell';

/**
 * O grupo de rotas da documentação pública.
 *
 * Fica FORA de `(dashboard)` de propósito: aquela shell exige sessão e
 * desenha a navegação do produto, e nenhuma das duas coisas serve a uma
 * referência de API que um integrador terceirizado precisa abrir sem
 * ter conta aqui. O que esta rota serve é conteúdo estático — contrato
 * de API e notas de versão — e nenhum dado de conta.
 *
 * `robots` vem do layout raiz, que já marca o produto inteiro como
 * `noindex`. Isso é deliberado também para estas páginas: a URL de uma
 * instância de CRM não é coisa que se queira num buscador, mesmo que o
 * conteúdo dela não seja segredo.
 */
export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DocsShell>{children}</DocsShell>;
}
