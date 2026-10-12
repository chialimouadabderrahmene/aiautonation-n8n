import { describe, expect, it } from "vitest";
import { parseInboundMessage } from "../src/modules/engine/whatsappWebhookSecurity";

/** Pure-function unit tests (no DB) for the WhatsApp webhook payload parser — Meta's
 * documented inbound-message notification shape. DB-touching behavior (signature
 * verification, the GET handshake, the full route) is covered by the real-Postgres
 * integration suite instead. */
describe("parseInboundMessage", () => {
  const validPayload = {
    entry: [{ changes: [{ value: {
      messages: [{ from: "15550001234", id: "wamid.ABC123", timestamp: "1700000000", type: "text", text: { body: "Hello" } }],
      contacts: [{ profile: { name: "Ada" }, wa_id: "15550001234" }],
    } }] }],
  };

  it("parses a valid text-message payload into the native event shape", () => {
    const result = parseInboundMessage(validPayload);
    expect(result).toEqual({
      phone: "15550001234", messageId: "wamid.ABC123", timestamp: "2023-11-14T22:13:20.000Z",
      type: "text", text: "Hello", senderName: "Ada", waId: "15550001234",
    });
  });

  it("returns null for a correctly-shaped payload with no messages (e.g. a status/read-receipt webhook)", () => {
    const statusPayload = { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.X", status: "read" }] } }] }] };
    expect(parseInboundMessage(statusPayload)).toBeNull();
  });

  it("returns null for a malformed/unexpected payload shape rather than throwing", () => {
    expect(parseInboundMessage({})).toBeNull();
    expect(parseInboundMessage(null)).toBeNull();
    expect(parseInboundMessage({ entry: [] })).toBeNull();
    expect(parseInboundMessage("not an object")).toBeNull();
  });

  it("strips non-digit characters from phone numbers (defense against odd formatting)", () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ from: "+1 (555) 000-1234", id: "wamid.Y", timestamp: "1700000000", type: "text", text: { body: "hi" } }] } }] }] };
    expect(parseInboundMessage(payload)?.phone).toBe("15550001234");
  });

  it("gives a non-text message an empty text body rather than guessing at its content", () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ from: "15550001234", id: "wamid.Z", timestamp: "1700000000", type: "image" }] } }] }] };
    expect(parseInboundMessage(payload)?.text).toBe("");
  });
});
