/**
 * The 20 native workflows, grouped into the six jobs a marketing team actually thinks in.
 * The team switches a job on or off; which workflows do that job is an implementation detail
 * that stays visible in the back office.
 */
export interface AutopilotDefinition {
  id: string;
  title: string;
  promise: string;
  when: string;
  /** What the team sees happen, in order. */
  steps: string[];
  workflows: string[];
  /** Run this one when someone presses "Try it now". */
  primary: string;
  needs: string[];
}

const AI = "openai|groq|codecraft";

export const AUTOPILOTS: AutopilotDefinition[] = [
  {
    id: "welcome-leads",
    title: "Welcome every new lead",
    promise: "Someone messages or signs up. Eki replies on WhatsApp, works out if they are a vendor or a buyer, and follows up over the next days.",
    when: "As soon as a lead arrives, then checks for follow-ups every morning",
    steps: ["Reply on WhatsApp within seconds", "Ask vendor or buyer", "Follow up over the first days, then re-engage if they go quiet", "Tell your team about hot leads"],
    workflows: ["lead-capture-webhook", "whatsapp-lead-funnel", "whatsapp-welcome-sequence", "whatsapp-engagement-followup", "whatsapp-nurture-sequences", "manychat-comment-funnel"],
    primary: "whatsapp-welcome-sequence",
    needs: ["whatsapp", "setting:whatsappTemplatesApproved"],
  },
  {
    id: "daily-content",
    title: "Write tomorrow's posts",
    promise: "Every morning Eki drafts fresh posts from your content calendar. Nothing goes out until you approve it in Review.",
    when: "Every day at 9:00 UTC",
    steps: ["Pick today's topic", "Draft the post in your brand voice", "Put it in Review for you"],
    workflows: ["ai-content-generation", "ai-social-autopilot", "content-multiplication-engine", "social-proof-engine"],
    primary: "ai-social-autopilot",
    needs: [AI],
  },
  {
    id: "post-on-schedule",
    title: "Post what you approved",
    promise: "Approved posts go out at the best times of the day, so nobody has to remember to press publish.",
    when: "Six times a day, 10:00 to 20:00 UTC",
    steps: ["Take the next approved post", "Publish it", "Mark it as posted"],
    workflows: ["social-post-scheduler"],
    primary: "social-post-scheduler",
    needs: ["buffer|x"],
  },
  {
    id: "find-ideas",
    title: "Find what people care about",
    promise: "Eki reads trending posts and community complaints so your next idea comes from real conversations.",
    when: "Every 6 hours and every morning",
    steps: ["Read trending posts", "Spot what people complain about", "Save the patterns for your next post"],
    workflows: ["viral-intelligence-engine", "pain-discovery-engine", "ab-testing-engine"],
    primary: "pain-discovery-engine",
    needs: [AI],
  },
  {
    id: "grow-list",
    title: "Grow the waitlist and referrals",
    promise: "New signups join the waitlist, referrers get credit, and unhappy feedback reaches your team straight away.",
    when: "Whenever someone signs up or gives feedback",
    steps: ["Add them to the waitlist", "Credit the person who referred them", "Alert the team about low ratings"],
    workflows: ["waitlist-management", "referral-campaign", "feedback-collection"],
    primary: "waitlist-management",
    needs: ["resend"],
  },
  {
    id: "weekly-report",
    title: "Send the Monday report",
    promise: "A plain summary of what was posted, who came in and what worked, ready before your Monday meeting.",
    when: "Every Monday at 9:00 UTC, plus a short daily digest",
    steps: ["Count posts, leads and messages", "Explain what worked", "Send it to your team"],
    workflows: ["weekly-analytics-report", "performance-analyst-agent", "autopilot-controller"],
    primary: "weekly-analytics-report",
    needs: ["resend", "field:resend.teamEmail"],
  },
];

/**
 * On means its scheduled or event-driven work is running. Webhook workflows only answer when
 * someone calls them, so they decide on/off only for a job made entirely of webhooks.
 */
export function isAutopilotOn(a: AutopilotDefinition, rows: { key: string; enabled: boolean; triggerType: string }[]): boolean {
  const mine = rows.filter((r) => a.workflows.includes(r.key));
  const active = mine.filter((r) => r.triggerType !== "WEBHOOK");
  return active.length ? active.some((r) => r.enabled) : mine.length > 0 && mine.every((r) => r.enabled);
}

export function findAutopilot(id: string): AutopilotDefinition | undefined {
  return AUTOPILOTS.find((a) => a.id === id);
}
