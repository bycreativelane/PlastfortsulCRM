import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  contact: {
    id: "c1",
    phone: "5551987654321",
    opted_out: false as boolean,
  },
  sendTemplateMessage: vi.fn(async () => ({ messageId: "wamid.1" })),
  sendTextMessage: vi.fn(async () => ({ messageId: "wamid.1" })),
  engineSendInteractiveButtons: vi.fn(async () => ({
    whatsapp_message_id: "wamid.btn",
  })),
}))

vi.mock("./admin-client", () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      if (table === "contacts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: { ...h.contact }, error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: () => "token",
}))

vi.mock("@/lib/whatsapp/meta-api", () => ({
  sendTextMessage: h.sendTextMessage,
  sendTemplateMessage: h.sendTemplateMessage,
}))

vi.mock("@/lib/flows/meta-send", () => ({
  engineSendInteractiveButtons: h.engineSendInteractiveButtons,
  engineSendInteractiveList: vi.fn(),
}))

vi.mock("@/lib/whatsapp/template-body", () => ({
  resolveTemplateRow: async () => ({ row: null }),
  templateContentText: () => "body",
}))

import {
  CONTACT_OPTED_OUT,
  engineSendInteractive,
  engineSendTemplate,
} from "./meta-send"

describe("automation send refuses opted-out contacts", () => {
  beforeEach(() => {
    h.contact.opted_out = false
    h.sendTemplateMessage.mockClear()
    h.engineSendInteractiveButtons.mockClear()
  })

  it("does not send a template after the customer opted out (wait then resume)", async () => {
    // The wait step already enqueued; cron resumes send_template later.
    h.contact.opted_out = true

    await expect(
      engineSendTemplate({
        accountId: "acc-1",
        userId: "user-1",
        conversationId: "conv-1",
        contactId: "c1",
        templateName: "recompra_60d",
      }),
    ).rejects.toThrow(CONTACT_OPTED_OUT)

    expect(h.sendTemplateMessage).not.toHaveBeenCalled()
  })

  it("does not send interactive via the flows helper either", async () => {
    h.contact.opted_out = true

    await expect(
      engineSendInteractive({
        accountId: "acc-1",
        userId: "user-1",
        conversationId: "conv-1",
        contactId: "c1",
        payload: {
          kind: "buttons",
          body: "hi",
          buttons: [{ id: "a", title: "A" }],
        },
      }),
    ).rejects.toThrow(CONTACT_OPTED_OUT)

    expect(h.engineSendInteractiveButtons).not.toHaveBeenCalled()
  })
})
