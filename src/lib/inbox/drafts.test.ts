import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DRAFTS_EVENT,
  MAX_DRAFTS,
  NO_DRAFTS,
  clearDraft,
  draftPreview,
  getDraft,
  getDrafts,
  parseDrafts,
  putDraft,
  resetDraftCacheForTests,
  setDraft,
  subscribeDrafts,
} from './drafts';

const ANA = 'c-ana';
const JOAO = 'c-joao';

describe('putDraft', () => {
  it('guarda por conversa, e uma não enxerga a outra', () => {
    let d = putDraft(NO_DRAFTS, ANA, 'Ola Ana, pode botar');
    d = putDraft(d, JOAO, 'Bom dia João');
    expect(d[ANA]).toBe('Ola Ana, pode botar');
    expect(d[JOAO]).toBe('Bom dia João');
  });

  it('apagar o texto apaga o rascunho', () => {
    const d = putDraft(putDraft(NO_DRAFTS, ANA, 'oi'), ANA, '');
    expect(ANA in d).toBe(false);
  });

  it('só espaço em branco é vazio', () => {
    // Um selo "Rascunho:" com três espaços atrás é uma linha mentindo.
    const d = putDraft(putDraft(NO_DRAFTS, ANA, 'oi'), ANA, '   \n  ');
    expect(ANA in d).toBe(false);
  });

  it('devolve a MESMA referência quando nada mudou', () => {
    // Cada tecla passa por aqui; um objeto novo por tecla re-renderizaria
    // a lista de conversas inteira à toa.
    const d = putDraft(NO_DRAFTS, ANA, 'oi');
    expect(putDraft(d, ANA, 'oi')).toBe(d);
    expect(putDraft(d, JOAO, '')).toBe(d);
  });

  it('mantém o espaço que está sendo digitado', () => {
    // "oi " é meio caminho de "oi Ana": aparar aqui apagaria o espaço
    // debaixo do cursor a cada tecla.
    expect(putDraft(NO_DRAFTS, ANA, 'oi ')[ANA]).toBe('oi ');
  });

  it('corta o mais antigo quando passa do teto', () => {
    let d: Readonly<Record<string, string>> = NO_DRAFTS;
    for (let i = 0; i < MAX_DRAFTS + 3; i++) d = putDraft(d, `c-${i}`, `t${i}`);
    expect(Object.keys(d)).toHaveLength(MAX_DRAFTS);
    expect('c-0' in d).toBe(false);
    expect('c-2' in d).toBe(false);
    expect(d[`c-${MAX_DRAFTS + 2}`]).toBe(`t${MAX_DRAFTS + 2}`);
  });

  it('escrever de novo salva o rascunho do corte', () => {
    let d = putDraft(NO_DRAFTS, ANA, 'primeiro');
    for (let i = 0; i < MAX_DRAFTS - 1; i++) d = putDraft(d, `c-${i}`, 't');
    // Ana é a mais antiga e cairia no próximo; tocar nela a leva para o fim.
    d = putDraft(d, ANA, 'primeiro, editado');
    d = putDraft(d, 'c-novo', 't');
    expect(d[ANA]).toBe('primeiro, editado');
    expect('c-0' in d).toBe(false);
  });
});

describe('parseDrafts', () => {
  it('aceita o que gravou', () => {
    expect(parseDrafts(JSON.stringify({ [ANA]: 'oi' }))).toEqual({
      [ANA]: 'oi',
    });
  });

  it.each([
    ['nada', null],
    ['vazio', ''],
    ['lixo', '{{{'],
    ['uma lista', '[1,2]'],
    ['um número', '42'],
  ])('devolve vazio para %s', (_nome, raw) => {
    expect(parseDrafts(raw)).toBe(NO_DRAFTS);
  });

  it('descarta a entrada podre e mantém a boa ao lado', () => {
    const raw = JSON.stringify({ [ANA]: 'oi', [JOAO]: 42, 'c-x': '  ' });
    expect(parseDrafts(raw)).toEqual({ [ANA]: 'oi' });
  });
});

describe('draftPreview', () => {
  it('vira uma linha só', () => {
    expect(draftPreview('Gostaria\nde confirmar\n\no pedido')).toBe(
      'Gostaria de confirmar o pedido'
    );
  });

  it('não corta por contagem — quem corta é o CSS', () => {
    const longo = 'a'.repeat(400);
    expect(draftPreview(longo)).toHaveLength(400);
  });
});

/**
 * Uma janela de mentira, porque esta suíte roda em `node`.
 *
 * O `vitest.config.ts` declara `environment: "node"` e o projeto não tem
 * jsdom instalado — nenhum teste aqui precisou de DOM até agora, e trazer
 * um ambiente inteiro (mais lento em toda a suíte) para exercitar
 * `getItem`/`setItem`/`addEventListener` seria caro pelo que entrega.
 *
 * O que isto prova de verdade: o espelho em memória, a invalidação por
 * `storage`, o aviso aos assinantes, e o `removeItem` quando o último
 * rascunho sai. O que NÃO prova: cota estourada e janela privada do
 * Safari, que são os dois `catch` do módulo. Esses estão escritos para
 * não fazer nada, que é a única coisa segura a fazer ali.
 */
class ArmazenamentoFalso {
  private mapa = new Map<string, string>();
  getItem(k: string) {
    return this.mapa.has(k) ? (this.mapa.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.mapa.set(k, String(v));
  }
  removeItem(k: string) {
    this.mapa.delete(k);
  }
  clear() {
    this.mapa.clear();
  }
}

describe('o armazenamento', () => {
  beforeEach(() => {
    const alvo = new EventTarget();
    (globalThis as { window?: unknown }).window = {
      localStorage: new ArmazenamentoFalso(),
      addEventListener: alvo.addEventListener.bind(alvo),
      removeEventListener: alvo.removeEventListener.bind(alvo),
      dispatchEvent: alvo.dispatchEvent.bind(alvo),
    };
    resetDraftCacheForTests();
  });

  it('sobrevive a fechar e reabrir a aba', () => {
    setDraft(ANA, 'Ola Ana');
    resetDraftCacheForTests();
    expect(getDraft(ANA)).toBe('Ola Ana');
  });

  it('enviar limpa só a conversa que enviou', () => {
    setDraft(ANA, 'Ola Ana');
    setDraft(JOAO, 'Bom dia');
    clearDraft(ANA);
    expect(getDraft(ANA)).toBe('');
    expect(getDraft(JOAO)).toBe('Bom dia');
  });

  it('some do disco quando o último rascunho vai embora', () => {
    setDraft(ANA, 'oi');
    clearDraft(ANA);
    expect(window.localStorage.getItem('wacrm:drafts')).toBeNull();
  });

  it('avisa quem está assinando', () => {
    const visto = vi.fn();
    const parar = subscribeDrafts(visto);
    setDraft(ANA, 'oi');
    expect(visto).toHaveBeenCalledTimes(1);
    parar();
    setDraft(ANA, 'oi de novo');
    expect(visto).toHaveBeenCalledTimes(1);
  });

  it('não avisa quando nada mudou', () => {
    setDraft(ANA, 'oi');
    const visto = vi.fn();
    const parar = subscribeDrafts(visto);
    setDraft(ANA, 'oi');
    expect(visto).not.toHaveBeenCalled();
    parar();
  });

  it('releitura estável: a mesma referência entre chamadas', () => {
    setDraft(ANA, 'oi');
    expect(getDrafts()).toBe(getDrafts());
  });

  it('a outra aba escreveu: o espelho é invalidado', () => {
    setDraft(ANA, 'meu');
    const visto = vi.fn();
    const parar = subscribeDrafts(visto);
    window.localStorage.setItem(
      'wacrm:drafts',
      JSON.stringify({ [JOAO]: 'da outra aba' })
    );
    window.dispatchEvent(
      Object.assign(new Event('storage'), { key: 'wacrm:drafts' })
    );
    expect(visto).toHaveBeenCalled();
    expect(getDraft(JOAO)).toBe('da outra aba');
    parar();
  });

  it('ignora um storage de outra chave', () => {
    const visto = vi.fn();
    const parar = subscribeDrafts(visto);
    window.dispatchEvent(
      Object.assign(new Event('storage'), { key: 'wacrm:theme' })
    );
    expect(visto).not.toHaveBeenCalled();
    parar();
  });

  it('o evento próprio tem o nome que a casa usa', () => {
    expect(DRAFTS_EVENT).toBe('wacrm:drafts');
  });
});
