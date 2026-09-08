"use client"

import * as React from "react"
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"

import { cn } from "@/lib/utils"
import { avatarClass } from "@/lib/avatar-color"

function Avatar({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: "default" | "sm" | "lg"
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6 dark:after:mix-blend-lighten",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn(
        "aspect-square size-full rounded-full object-cover",
        className
      )}
      {...props}
    />
  )
}

/**
 * The initials, when the photo is missing or has not loaded.
 *
 * `seed` — normally the person's name — picks one of the eight avatar fills
 * (see `@/lib/avatar-color`), so the same person keeps the same disc
 * everywhere and the disc is actually visible against the surface behind it.
 * Without a seed it keeps the old neutral, for the places where no name is
 * in hand.
 */
function AvatarFallback({
  className,
  seed,
  ...props
}: AvatarPrimitive.Fallback.Props & { seed?: string | null }) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full text-sm group-data-[size=sm]/avatar:text-xs",
        seed
          ? `${avatarClass(seed)} text-avatar-ink`
          : "bg-muted text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground bg-blend-color ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

/*
 * `AvatarGroup` e `AvatarGroupCount` VIVIAM AQUI, e sairam.
 *
 * Eram andaime do shadcn com zero chamadas, e zero chamadas aqui nao queria
 * dizer "ainda nao adotado" — queria dizer que nao servem a este app.
 *
 * A pilha existe em UM lugar so, a barra de presenca, e ela e feita de
 * `MemberAvatar`, que embrulha o `Avatar` num `<span>` para pendurar o ponto
 * de presenca. O servico principal do grupo era o anel — `*:data-[slot=avatar]`,
 * um seletor de FILHO — e ele nao atravessa esse `<span>`. Restava o
 * `-space-x-2`, que e uma classe.
 *
 * O `AvatarGroupCount` estava ainda mais longe: 32px com `text-sm` e
 * `ring-background`, contra os 28px, `text-3xs` e `ring-card` que a pilha
 * real usa — e a escada dele responde a um `data-size` que o `MemberAvatar`
 * nao escreve. Adotar os dois seria sobrescrever quase tudo o que eles
 * trazem, que e o oposto de usar um componente.
 *
 * Se um dia aparecer uma segunda pilha, o lugar dela e a familia do
 * `MemberAvatar`, com a escada e o `ringClass` que ela ja tem.
 */

export { Avatar, AvatarImage, AvatarFallback, AvatarBadge }
