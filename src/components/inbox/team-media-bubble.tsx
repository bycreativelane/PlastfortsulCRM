'use client';

import { Download, FileText, ImageOff, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { teamMediaKind } from '@/lib/team/media';
import type { TeamMessage } from '@/lib/team/messages';

/**
 * O anexo de uma mensagem da sala da equipe.
 *
 * ------------------------------------------------------------------
 * POR QUE NÃO É O `message-media.tsx` DO ATENDIMENTO
 * ------------------------------------------------------------------
 *
 * Aquele componente é bom e faz quase a mesma coisa. Duas diferenças o
 * impedem de ser reusado sem uma refatoração maior do que este arquivo:
 *
 *   · Ele é tipado contra o `Message` da inbox e lê `message.media_url`.
 *     A sala não TEM url — o balde é privado, a coluna guarda o caminho,
 *     e a url chega de fora, assinada e temporária.
 *   · Ele carrega o download por `downloadMediaMessage(message)`, que
 *     também parte de `media_url` e do id da mensagem da inbox.
 *
 * Generalizar aquele arquivo para aceitar "uma src resolvida e um tipo"
 * é a jogada certa **quando a segunda diferença sumir**. Hoje ela seria
 * uma refatoração num componente que serve a tela mais usada do produto,
 * para acomodar uma tela nova — e a ordem correta é a nova provar que
 * merece, não a antiga arriscar.
 *
 * O que este arquivo NÃO faz, de propósito: lightbox, navegação entre
 * mídias e player customizado. A sala é conversa entre colegas, não
 * curadoria — `<img>`, `<video controls>` e `<audio controls>` são o que
 * o navegador já faz bem.
 */
export function TeamMediaBubble({
  message,
  src,
  labels,
}: {
  message: TeamMessage;
  /**
   * A url assinada, ou `undefined` enquanto o lote não voltou / se ele
   * falhou para este caminho. Ver `signTeamMedia`.
   */
  src: string | undefined;
  labels: {
    unavailable: string;
    download: string;
    document: string;
  };
}) {
  const kind = teamMediaKind(message.media_mime);
  const name = message.media_name || labels.document;

  // Sem url o balão não fica em branco nem tenta `src=""` — que o
  // navegador resolve pedindo a própria página de novo e desenha um
  // ícone de imagem quebrada sem explicação.
  if (!src) {
    return (
      <div className="border-border text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
        <ImageOff className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{labels.unavailable}</span>
      </div>
    );
  }

  if (kind === 'image') {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="block">
        {/* `max-h` e não só `max-w`: um print de tela em retrato tem
            2000px de altura, e sem teto ele empurra o resto da conversa
            para fora da tela — quem mandou queria mostrar, não ocupar. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name}
          className="max-h-80 w-auto max-w-full rounded-lg object-contain"
        />
      </a>
    );
  }

  if (kind === 'video') {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        className="max-h-80 w-auto max-w-full rounded-lg"
      />
    );
  }

  if (kind === 'audio') {
    // `w-60` fixo: o player nativo estica até o container, e um áudio de
    // três segundos ocupando a largura da sala parece um erro.
    return <audio src={src} controls className="w-60 max-w-full" />;
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      download={name}
      className={cn(
        'border-border bg-card-2 hover:bg-muted flex min-w-0 items-center gap-2',
        'rounded-lg border px-3 py-2 text-sm transition-colors'
      )}
    >
      <FileText className="text-muted-foreground size-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <Download className="text-muted-foreground size-4 shrink-0" />
    </a>
  );
}

/** O que aparece enquanto o arquivo sobe, no lugar do balão. */
export function TeamMediaUploading({ label }: { label: string }) {
  return (
    <div className="border-border text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
      <Loader2 className="size-4 shrink-0 animate-spin" />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}
