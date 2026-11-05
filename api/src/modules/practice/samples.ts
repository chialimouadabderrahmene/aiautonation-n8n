import { LeadStatus, LeadType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { PRACTICE_PHONE_PREFIX } from "../../lib/practice";

const SEEDED_KEY = "_practiceSamplesSeeded";
export const SAMPLE_SOURCE = "practice-sample";

const SAMPLE_LEADS: { suffix: string; name: string; market: string; type: LeadType; status: LeadStatus; source: string; hot?: boolean; talk: [string, string][] }[] = [
  {
    suffix: "101", name: "Sample: Ada", market: "United Kingdom", type: LeadType.BUYER, status: LeadStatus.WELCOMED, source: "Instagram reel",
    talk: [["Hi, I saw your reel. Do you deliver egusi to Manchester?", "Hi Ada! Welcome to Eki. I can help you find vendors near you. Are you looking to buy or to sell?"], ["Buy", "Lovely. Open Eki to browse vendors who deliver to your area."]],
  },
  {
    suffix: "102", name: "Sample: Tunde", market: "United Kingdom", type: LeadType.VENDOR, status: LeadStatus.CONTACTED, source: "WhatsApp group", hot: true,
    talk: [["I sell palm oil and stockfish in Peckham. How do I open a store?", "Great to meet you, Tunde. Eki gives vendors their own storefront. Our team will message you with the next steps."]],
  },
  {
    suffix: "103", name: "Sample: Chioma", market: "Canada", type: LeadType.BUYER, status: LeadStatus.NEW, source: "Landing page",
    talk: [],
  },
  {
    suffix: "104", name: "Sample: Kemi", market: "United States", type: LeadType.UNKNOWN, status: LeadStatus.NEW, source: "Instagram comment",
    talk: [["Hello", "Hi Kemi! Welcome to Eki. Are you looking to buy African foodstuff, or do you sell it?"]],
  },
];

const SAMPLE_DRAFTS = [
  { platform: "instagram", body: "[Practice sample] You should not have to cross town for good ogbono. Eki brings the vendors to your phone.", hashtags: ["#Eki", "#AfricanFood"] },
  { platform: "x", body: "[Practice sample] Vendors: your customers already miss your food. Eki gives you a storefront they can find.", hashtags: ["#Eki"] },
];

/** Fills an empty practice workspace once so nobody ever learns on a blank screen. */
export async function ensureSamples(): Promise<void> {
  // Two screens can open at once on a first visit; only whoever wins the insert seeds.
  const { count } = await prisma.setting.createMany({ data: [{ key: SEEDED_KEY, value: true }], skipDuplicates: true });
  if (count) await loadSamples();
}

export async function loadSamples(): Promise<void> {
  for (const lead of SAMPLE_LEADS) {
    const phone = `${PRACTICE_PHONE_PREFIX}${lead.suffix}`;
    await prisma.engineLead.upsert({
      where: { phone },
      update: {},
      create: { phone, name: lead.name, market: lead.market, leadType: lead.type, status: lead.status, source: lead.source, highIntent: lead.hot ?? false },
    });
    for (const [i, [text, reply]] of lead.talk.entries()) {
      await prisma.engineWhatsAppConversation.upsert({
        where: { messageId: `practice-seed-${lead.suffix}-${i}` },
        update: {},
        create: { phone, messageText: text, replySent: reply, conversationStep: "sample", messageId: `practice-seed-${lead.suffix}-${i}` },
      });
    }
  }
  if ((await prisma.engineContentDraft.count({ where: { source: SAMPLE_SOURCE } })) === 0) {
    await prisma.engineContentDraft.createMany({ data: SAMPLE_DRAFTS.map((d) => ({ ...d, source: SAMPLE_SOURCE, contentType: "caption" })) });
  }
  if ((await prisma.brandProfile.count()) === 0) {
    await prisma.brandProfile.create({
      data: {
        name: "Eki (starter)",
        isActive: true,
        primaryColorHex: "#1C1410",
        accentColorHex: "#F2A93B",
        voiceAdjectives: ["warm", "direct", "proud of African food"],
        tone: "Friendly and practical",
        formality: "Casual",
        sentenceStyle: "Short sentences",
        preferredPhrases: ["the taste of home"],
        bannedWords: [],
        ctaStyle: "One clear next step",
        exampleSentences: ["Your people, your food, one tap away."],
      },
    });
  }
}

/** Removes everything Practice mode made. Real leads, posts and brand edits are untouched. */
export async function clearPracticeData(): Promise<{ videos: number; carousels: number; leads: number; drafts: number }> {
  const videos = await prisma.videoProject.deleteMany({ where: { testMode: true } });
  const carousels = await prisma.carouselProject.deleteMany({ where: { testMode: true } });
  const drafts = await prisma.engineContentDraft.deleteMany({ where: { OR: [{ source: SAMPLE_SOURCE }, { body: { startsWith: "[Practice sample]" } }] } });
  const prefix = { startsWith: PRACTICE_PHONE_PREFIX };
  await prisma.engineWhatsAppConversation.deleteMany({ where: { phone: prefix } });
  const leads = await prisma.engineLead.deleteMany({ where: { phone: prefix } });
  await prisma.engineTrendPattern.deleteMany({ where: { content: { contains: "Practice sample" } } }).catch(() => undefined);
  await prisma.enginePainPoint.deleteMany({ where: { pain: { contains: "Practice sample" } } }).catch(() => undefined);
  return { videos: videos.count, carousels: carousels.count, leads: leads.count, drafts: drafts.count };
}
