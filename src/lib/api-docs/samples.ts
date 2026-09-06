// ============================================================
// Os exemplos de código, GERADOS a partir do endpoint.
//
// Escritos à mão, cURL, JavaScript e Python divergem na primeira
// mudança de rota: alguém corrige o `curl` que copiou do terminal e os
// outros dois seguem mentindo por meses, porque ninguém roda o exemplo
// de Python de uma documentação interna. Derivados de `Endpoint`, os
// três mudam juntos ou não mudam.
//
// O corpo é o `requestExample` do spec, colado literalmente — inclusive
// a ordem das chaves, que a prosa ao lado cita. Reserializar via
// JSON.parse reordenaria e perderia o alinhamento.
// ============================================================

import type { Endpoint, Language } from './types';

export type SampleLang = 'curl' | 'js' | 'python';

export const SAMPLE_LANGS: {
  id: SampleLang;
  label: string;
  syntax: Language;
}[] = [
  { id: 'curl', label: 'cURL', syntax: 'bash' },
  { id: 'js', label: 'JavaScript', syntax: 'js' },
  { id: 'python', label: 'Python', syntax: 'python' },
];

/** Indenta um bloco JSON já formatado, para encaixá-lo numa expressão. */
function indent(code: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return code
    .split('\n')
    .map((line, i) => (i === 0 ? line : pad + line))
    .join('\n');
}

/**
 * O corpo, com `true`/`false`/`null` traduzidos para Python.
 *
 * Ingênuo de propósito: só toca literais soltos, delimitados por
 * fronteira de palavra e fora de aspas na prática, porque os exemplos
 * do spec são JSON pequeno e escrito à mão. Um dicionário de verdade
 * exigiria um parser, e um parser aqui pagaria por um problema que
 * estes exemplos não têm.
 */
function toPythonLiterals(json: string): string {
  return json
    .replace(/\btrue\b/g, 'True')
    .replace(/\bfalse\b/g, 'False')
    .replace(/\bnull\b/g, 'None');
}

export function buildSample(
  endpoint: Endpoint,
  lang: SampleLang,
  baseUrl: string
): string {
  const url = `${baseUrl}${endpoint.path}`;
  const body = endpoint.requestExample;
  const method = endpoint.method;

  if (lang === 'curl') {
    const lines = [
      method === 'GET' ? `curl ${url} \\` : `curl -X ${method} ${url} \\`,
      `  -H "Authorization: Bearer $WACRM_KEY"${body ? ' \\' : ''}`,
    ];
    if (body) {
      lines.push(`  -H "Content-Type: application/json" \\`);
      lines.push(`  -d '${indent(body, 5)}'`);
    }
    return lines.join('\n');
  }

  if (lang === 'js') {
    const init: string[] = [];
    if (method !== 'GET') init.push(`  method: '${method}',`);
    init.push(`  headers: {`);
    init.push(`    Authorization: \`Bearer \${process.env.WACRM_KEY}\`,`);
    if (body) init.push(`    'Content-Type': 'application/json',`);
    init.push(`  },`);
    if (body) init.push(`  body: JSON.stringify(${indent(body, 2)}),`);

    return `const res = await fetch('${url}', {
${init.join('\n')}
});

const { data, error } = await res.json();
if (!res.ok) throw new Error(error.code);`;
  }

  const headers = body
    ? `headers={\n        "Authorization": f"Bearer {os.environ['WACRM_KEY']}",\n        "Content-Type": "application/json",\n    },`
    : `headers={"Authorization": f"Bearer {os.environ['WACRM_KEY']}"},`;

  return `import os
import requests

res = requests.${method.toLowerCase()}(
    "${url}",
    ${headers}${
      body
        ? `
    json=${indent(toPythonLiterals(body), 4)},`
        : ''
    }
    timeout=30,
)

payload = res.json()
res.raise_for_status()`;
}
