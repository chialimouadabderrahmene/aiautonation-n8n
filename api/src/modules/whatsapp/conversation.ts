/**
 * WhatsApp 1:1 conversation state machine — the native port of n8n workflow
 * 13's session-reply logic (see WHATSAPP_FUNNEL_SETUP.md), extended with the
 * two states the pivot adds: JOIN -> group invite link, and the
 * signup -> product-listing flow once a vendor is captured.
 *
 * This is the compliant half of "keyword -> WhatsApp group -> signup" from
 * the pivot gap analysis: the Cloud API cannot read or message inside a
 * WhatsApp group, so the group stays a community space (its own invite link,
 * its own pinned message) and every state transition below happens in this
 * 1:1 conversation, exactly as it does today.
 */
import { prisma } from "../../lib/prisma";
import { WhatsAppContact, WhatsAppContactStatus } from "@prisma/client";
import { getSetting } from "../settings/schema";
import { notifyAdmin } from "../telegram/telegram";

const GREETING = /^(hi|hello|ciao|hey|start)\b/i;
const STOP = /\b(stop|unsubscribe|quit|cancel|opt[\s-]?out|basta|stop all)\b/i;
const BUYER = /\b(buyer|buy|acquirente|comprare|customer|shopping)\b/i;
const VENDOR = /\b(vendor|sell|venditore|vendere|seller|business|shop owner)\b/i;
const JOIN = /\bjoin\b/i;

const FOOTER = "\n\nReply STOP anytime to opt out.";

export interface ConversationResult {
  reply: string | null;
  contact: WhatsAppContact;
}

async function upsertContact(phone: string, source: string): Promise<WhatsAppContact> {
  return prisma.whatsAppContact.upsert({
    where: { phone },
    update: { lastMessageAt: new Date() },
    create: { phone, source, status: "NEW" },
  });
}

async function log(contactId: string, direction: "in" | "out", body: string): Promise<void> {
  await prisma.whatsAppMessage.create({ data: { contactId, direction, body: body.slice(0, 4096) } });
}

async function setStatus(id: string, data: Partial<{ status: WhatsAppContactStatus; role: string; optIn: boolean; entryKeyword: string; name: string }>): Promise<WhatsAppContact> {
  return prisma.whatsAppContact.update({ where: { id }, data });
}

/**
 * Processes one inbound message and returns the reply to send (or null for
 * an unsubscribed contact, which workflow 13 also never replies to). The
 * caller (the webhook route) persists nothing else — every state change
 * happens here so the logic stays testable without the HTTP layer.
 */
export async function handleInboundMessage(phone: string, text: string, source = "whatsapp"): Promise<ConversationResult> {
  const trimmed = text.trim();
  let contact = await upsertContact(phone, source);
  await log(contact.id, "in", trimmed);

  if (contact.status === "UNSUBSCRIBED" && !/^start$/i.test(trimmed)) {
    return { reply: null, contact };
  }

  if (STOP.test(trimmed)) {
    contact = await setStatus(contact.id, { status: "UNSUBSCRIBED", optIn: false });
    const reply = `You're unsubscribed — you won't receive further messages. Reply START anytime to come back.${FOOTER}`;
    await log(contact.id, "out", reply);
    return { reply, contact };
  }

  // A contact mid-listing stays in that flow regardless of keywords, until it's complete.
  if (contact.status === "LISTING_PRODUCT") return continueProductListing(contact, trimmed);

  if (JOIN.test(trimmed)) {
    const link = await getSetting<string>("whatsappGroupInviteLink");
    const reply = link
      ? `Here's the Eki community group: ${link}\n\nWhen you're ready to sign up and list a product, just message VENDOR or BUYER here.${FOOTER}`
      : `Thanks for your interest! The community group link isn't set up yet — message VENDOR or BUYER and we'll get you started directly.${FOOTER}`;
    contact = await setStatus(contact.id, { entryKeyword: "JOIN", optIn: true });
    await log(contact.id, "out", reply);
    return { reply, contact };
  }

  if (GREETING.test(trimmed)) {
    // NEW or UNSUBSCRIBED (START re-subscribes, per workflow 13's documented
    // behaviour) both land on AWAITING_ROLE; anything further along its own
    // flow (SIGNUP_IN_PROGRESS etc.) is left where it is.
    const revive = contact.status === "NEW" || contact.status === "UNSUBSCRIBED";
    contact = await setStatus(contact.id, { optIn: true, status: revive ? "AWAITING_ROLE" : contact.status });
    const reply = `Hi! 👋 Eki is a marketplace connecting African foodstuff vendors with buyers worldwide. Are you a Buyer or a Vendor?${FOOTER}`;
    await log(contact.id, "out", reply);
    return { reply, contact };
  }

  if (VENDOR.test(trimmed)) {
    contact = await setStatus(contact.id, { role: "vendor", status: "SIGNUP_IN_PROGRESS", optIn: true, entryKeyword: contact.entryKeyword ?? "VENDOR" });
    const reply = `Great — let's get your store started. What's your name, your country, and what do you sell?${FOOTER}`;
    await log(contact.id, "out", reply);
    await notifyAdmin(`🔥 High-intent vendor lead on WhatsApp: ${phone}`).catch(() => undefined);
    return { reply, contact };
  }

  if (BUYER.test(trimmed)) {
    contact = await setStatus(contact.id, { role: "buyer", status: "SIGNUP_IN_PROGRESS", optIn: true, entryKeyword: contact.entryKeyword ?? "BUYER" });
    const reply = `Welcome! What's your name and country? We'll help you find trusted vendors for what you're after.${FOOTER}`;
    await log(contact.id, "out", reply);
    return { reply, contact };
  }

  if (contact.status === "SIGNUP_IN_PROGRESS" && contact.role === "vendor") {
    contact = await setStatus(contact.id, { name: trimmed.slice(0, 200), status: "LISTING_PRODUCT" });
    await prisma.productListing.create({ data: { contactId: contact.id, status: "DRAFT" } });
    const reply = `Thanks! Now let's list your first product. What is it called?${FOOTER}`;
    await log(contact.id, "out", reply);
    return { reply, contact };
  }

  if (contact.status === "SIGNUP_IN_PROGRESS" && contact.role === "buyer") {
    contact = await setStatus(contact.id, { name: trimmed.slice(0, 200), status: "COMPLETE" });
    const appLink = await getSetting<string>("appDownloadLink");
    const reply = `Thanks, ${trimmed.split(/\s+/)[0]}! A member of the Eki team will follow up.${appLink ? ` In the meantime: ${appLink}` : ""}${FOOTER}`;
    await log(contact.id, "out", reply);
    return { reply, contact };
  }

  const appLink = await getSetting<string>("appDownloadLink");
  const reply = `Thanks for the info! A member of the Eki team will follow up.${appLink ? ` ${appLink}` : ""}${FOOTER}`;
  await log(contact.id, "out", reply);
  return { reply, contact };
}

/** Collects name -> description -> price for the DRAFT ProductListing created when LISTING_PRODUCT starts. */
async function continueProductListing(contact: WhatsAppContact, text: string): Promise<ConversationResult> {
  const listing = await prisma.productListing.findFirst({ where: { contactId: contact.id, status: "DRAFT" }, orderBy: { createdAt: "desc" } });
  if (!listing) {
    // Shouldn't happen (status implies a draft exists) — fail safe back to the general flow rather than losing the message.
    const updated = await setStatus(contact.id, { status: "COMPLETE" });
    return { reply: "Thanks! A member of the Eki team will follow up.", contact: updated };
  }
  let reply: string;
  if (!listing.name) {
    await prisma.productListing.update({ where: { id: listing.id }, data: { name: text.slice(0, 200) } });
    reply = "Got it. Give a short description of the product.";
  } else if (!listing.description) {
    await prisma.productListing.update({ where: { id: listing.id }, data: { description: text.slice(0, 1000) } });
    reply = "What's the price?";
  } else if (!listing.price) {
    await prisma.productListing.update({ where: { id: listing.id }, data: { price: text.slice(0, 100), status: "SUBMITTED" } });
    reply = "Your listing is in — a member of the Eki team will review it and follow up to finish setting up your store.";
    await notifyAdmin(`📦 New product listing submitted via WhatsApp (${contact.phone}): ${listing.name}`).catch(() => undefined);
  } else {
    reply = "Thanks — that's noted.";
  }
  const updated = reply.startsWith("Your listing is in") ? await setStatus(contact.id, { status: "COMPLETE" }) : contact;
  await log(contact.id, "out", `${reply}${FOOTER}`);
  return { reply: `${reply}${FOOTER}`, contact: updated };
}
