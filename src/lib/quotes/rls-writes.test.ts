import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * NENHUMA ESCRITA EM `deal_quotes` QUE A RLS DESCARTE EM SILÊNCIO.
 *
 * ------------------------------------------------------------------
 * O DEFEITO QUE ESTE TESTE EXISTE PARA NÃO DEIXAR VOLTAR
 * ------------------------------------------------------------------
 *
 * `POST /api/quotes` gravava os links do PDF com `supabase.from(
 * 'deal_quotes').update(...)`, usando o client da SESSÃO. A 071 dá a essa
 * tabela política de SELECT e INSERT e, de propósito, nenhuma de UPDATE.
 * Sem política, o Postgres casa zero linhas; o PostgREST devolve sucesso;
 * nada é gravado. Medido em 14 de setembro de 2026: 9 orçamentos no banco
 * de teste, nenhum com `pdf_url`, e os arquivos de todos no bucket.
 *
 * TypeScript não pega isso e nenhum teste de unidade pega isso — o erro
 * não existe, é a ausência de efeito. O que dá para ler é a combinação:
 * as migrações dizem quais comandos têm política, e o código diz quais
 * comandos cada escrita usa e por qual client.
 *
 * ------------------------------------------------------------------
 * A REGRA
 * ------------------------------------------------------------------
 *
 * Um UPDATE, DELETE ou UPSERT em `deal_quotes` só pode passar por um
 * client de SERVIÇO (o receptor tem "admin" no nome — `quotesAdmin()`, ou
 * o parâmetro `admin` de uma função que o recebe), a menos que as
 * migrações criem política para aquele comando. Se um dia criarem, este
 * teste passa a aceitar o client da sessão sozinho — é isso que ele lê.
 */

const RAIZ = process.cwd();

function arquivos(dir: string, filtro: (p: string) => boolean): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome === 'node_modules' || nome.startsWith('.')) continue;
      saida.push(...arquivos(caminho, filtro));
    } else if (filtro(caminho)) {
      saida.push(caminho);
    }
  }
  return saida;
}

/** Os comandos com política em `deal_quotes`, somando todas as migrações. */
function comandosComPolitica(): Set<string> {
  const sql = arquivos(join(RAIZ, 'supabase', 'migrations'), (p) =>
    p.endsWith('.sql')
  )
    .map((p) => readFileSync(p, 'utf8').replace(/--[^\n]*/g, ''))
    .join('\n');
  const comandos = new Set<string>();
  const re =
    /CREATE\s+POLICY\s+\w+\s+ON\s+(?:public\.)?deal_quotes\s+FOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) comandos.add(m[1].toUpperCase());
  return comandos;
}

interface Escrita {
  arquivo: string;
  receptor: string;
  comando: 'UPDATE' | 'DELETE' | 'UPSERT';
}

/** Toda escrita em `deal_quotes` no código, com o client que a faz. */
function escritas(): Escrita[] {
  const fontes = arquivos(join(RAIZ, 'src'), (p) =>
    /\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p)
  );
  const achadas: Escrita[] = [];
  const re =
    /([A-Za-z_$][\w$]*(?:\(\))?)\s*\.from\(\s*['"]deal_quotes['"]\s*\)([\s\S]*?);/g;
  for (const arquivo of fontes) {
    const codigo = readFileSync(arquivo, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(codigo)) !== null) {
      const cadeia = m[2];
      const comando = /\.update\(/.test(cadeia)
        ? 'UPDATE'
        : /\.delete\(/.test(cadeia)
          ? 'DELETE'
          : /\.upsert\(/.test(cadeia)
            ? 'UPSERT'
            : null;
      if (!comando) continue;
      achadas.push({
        arquivo: relative(RAIZ, arquivo).replace(/\\/g, '/'),
        receptor: m[1],
        comando,
      });
    }
  }
  return achadas;
}

describe('escritas em deal_quotes', () => {
  it('as migrações continuam sem UPDATE e DELETE para o client (071)', () => {
    // Se isto mudar, a regra do topo muda junto — e é para mudar de
    // propósito, não por acidente.
    const comandos = comandosComPolitica();
    expect(comandos.has('SELECT')).toBe(true);
    expect(comandos.has('INSERT')).toBe(true);
  });

  it('nenhuma escrita sem política passa pelo client da sessão', () => {
    const comandos = comandosComPolitica();
    const permitidoSemAdmin = (comando: Escrita['comando']) =>
      comandos.has('ALL') ||
      (comando === 'UPSERT'
        ? comandos.has('INSERT') && comandos.has('UPDATE')
        : comandos.has(comando));

    const acha = escritas();
    // Sem nenhuma escrita achada o teste não mede nada: o `attachQuoteFiles`
    // tem de aparecer aqui.
    expect(acha.length).toBeGreaterThan(0);

    const descartadas = acha.filter(
      (e) => !permitidoSemAdmin(e.comando) && !/admin/i.test(e.receptor)
    );
    expect(
      descartadas.map((e) => `${e.arquivo}: ${e.receptor} → ${e.comando}`)
    ).toEqual([]);
  });
});
