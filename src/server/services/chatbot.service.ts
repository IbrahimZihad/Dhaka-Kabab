import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { formatPoisa, bpsToPercentLabel } from "@/lib/money";
import { randomToken } from "@/lib/ids";
import { describeOpeningHours, isOpenAt, parseOpeningHours, zonedParts } from "@/lib/time";
import { getSettings } from "@/server/services/settings.service";
import { getMenuSnapshotForChat } from "@/server/services/menu.service";
import { getAvailability, getReservationByToken, reservationFactsForChat, type SlotAvailability } from "@/server/services/reservation.service";
import { getOrderByPublicToken } from "@/server/services/order.service";
import { providerReadiness } from "@/server/services/providers";
import { completeChat, aiProviderStatus, type LlmMessage } from "@/server/services/providers/llm";
import { queueNotification } from "@/server/services/notification.service";
import type { ChatSendInput } from "@/server/validation/chat";

/**
 * Customer-facing assistant. Two properties are non-negotiable:
 *   1. Every factual sentence traces back to a row we read from the database in
 *      this request (menu, settings, live availability, this visitor's order).
 *   2. When we do not know — no matching dish, no recorded allergen, no table
 *      data, provider down — the reply says so and offers a human. A missing
 *      answer is acceptable; an invented one is not.
 */

const STOPWORDS = new Set([
  "what", "whats", "when", "where", "which", "who", "how", "do", "does", "did", "is", "are", "can", "could",
  "you", "your", "we", "our", "the", "a", "an", "to", "of", "for", "and", "or", "in", "on", "at", "with",
  "have", "has", "any", "much", "many", "please", "tell", "give", "show", "list", "me", "i", "im", "id",
  "like", "want", "need", "there", "here", "that", "this", "it", "its", "about", "from", "they", "them",
]);

export type ChatFactSource = { kind: string; label: string };

export type ChatAnswer = {
  conversationToken: string;
  reply: string;
  answeredBy: "ai" | "menu-data" | "settings" | "availability" | "order" | "staff-handoff";
  usedFallback: boolean;
  notice: string | null;
  model: string | null;
  sources: ChatFactSource[];
  suggestions: { label: string; href: string }[];
};

type Grounding = {
  restaurant: {
    name: string;
    address: string;
    phone: string;
    email: string;
    hours: string;
    openNow: boolean;
    mapsUrl: string | null;
  };
  ordering: {
    dineIn: boolean;
    takeaway: boolean;
    delivery: boolean;
    deliveryFee: string;
    charges: string;
    payments: string;
  };
  reservation: Awaited<ReturnType<typeof reservationFactsForChat>> | null;
  availability: SlotAvailability | null;
  availabilityAskedFor: { dateKey: string; partySize: number } | null;
  items: {
    name: string;
    category: string;
    priceLabel: string;
    available: boolean;
    description: string;
    ingredients: string;
    allergens: string;
  }[];
  matched: string[];
  orderLookup: { orderNumber: string; status: string; table: string | null; totalLabel: string; placedAt: string } | null;
  reservationLookup: { code: string; status: string; startsAt: string; partySize: number } | null;
};

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function ensureConversation(conversationToken?: string, tableToken?: string) {
  if (conversationToken) {
    const existing = await prisma.chatConversation.findUnique({ where: { publicToken: conversationToken } });
    if (existing) return existing;
  }
  return prisma.chatConversation.create({
    data: { publicToken: randomToken(12), tableToken: tableToken ?? null },
  });
}

async function history(conversationId: string, limit = 8): Promise<LlmMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { role: true, content: true },
  });
  return rows
    .reverse()
    .filter((row) => row.role === "USER" || row.role === "ASSISTANT")
    .map((row) => ({ role: row.role === "USER" ? ("user" as const) : ("assistant" as const), content: row.content }));
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

function questionTokens(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function parsePartySize(question: string): number | null {
  const direct = /(\d{1,3})\s*(?:people|persons|guests|pax|members)/.exec(question.toLowerCase());
  if (direct) return Number(direct[1]);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
  const word = /(?:for\s+|of\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s+(?:people|persons|guests|of\s+us)/.exec(question.toLowerCase());
  return word ? (words[word[1]] ?? null) : null;
}

/** Only whole-date mentions resolve; a bare "tomorrow" would be a guess we refuse to make. */
function parseDateKey(question: string, timeZone: string): string | null {
  const iso = /(2\d{3}-\d{2}-\d{2})/.exec(question);
  if (iso) return iso[1];
  const today = zonedParts(new Date(), timeZone).dateKey;
  if (/\btonight\b|\btoday\b/.test(question.toLowerCase())) return today;
  return null;
}

async function buildGrounding(question: string): Promise<Grounding> {
  const settings = await getSettings();
  const rules = parseOpeningHours(settings.openingHours);
  const now = new Date();
  const tokens = questionTokens(question);

  const snapshot = await getMenuSnapshotForChat();
  const matched = snapshot.filter((item) => {
    const haystack = `${item.name} ${item.category.name} ${item.description ?? ""} ${item.ingredients ?? ""} ${item.allergens ?? ""}`.toLowerCase();
    return tokens.some((token) => token.length > 2 && haystack.includes(token));
  });
  const relevant = (matched.length > 0 ? matched : snapshot.filter((item) => item.available)).slice(0, 24);

  const charges: string[] = [];
  if (settings.serviceChargeBps > 0) charges.push(`${bpsToPercentLabel(settings.serviceChargeBps)}% service charge`);
  if (settings.vatBps > 0) charges.push(`${bpsToPercentLabel(settings.vatBps)}% VAT`);

  /**
   * Whether a guest may pay online at all, and what to call the gateway when they
   * may. The probe runs in a `try` because a settings row that names a gateway this
   * server cannot build must not stop the assistant talking about the menu; the
   * sentence below then falls back to the counter.
   */
  let gateway: Awaited<ReturnType<typeof providerReadiness>> | null = null;
  try {
    gateway = await providerReadiness();
  } catch {
    gateway = null;
  }

  const wantsAvailability = /reserv|book|table/.test(question.toLowerCase());
  const partySize = parsePartySize(question);
  const dateKey = parseDateKey(question, settings.timezone);
  let availability: SlotAvailability | null = null;
  let availabilityAskedFor: { dateKey: string; partySize: number } | null = null;
  if (wantsAvailability && dateKey && partySize) {
    availability = await getAvailability(dateKey, partySize).catch(() => null);
    availabilityAskedFor = { dateKey, partySize };
  }

  // A visitor may quote an order or booking code; that lookup is scoped to the
  // code they typed, never to somebody else's history.
  let orderLookup: Grounding["orderLookup"] = null;
  let reservationLookup: Grounding["reservationLookup"] = null;
  const codeMatch = /\b(DK-\d{6}-\d{4}|[A-Za-z0-9]{10,20})\b/.exec(question);
  if (codeMatch) {
    orderLookup = await getOrderByPublicToken(codeMatch[1])
      .then((order) => ({
        orderNumber: order.orderNumber,
        status: order.status,
        table: order.table?.label ?? null,
        totalLabel: formatPoisa(order.totalPoisa, { symbol: settings.currencySymbol }),
        placedAt: order.createdAt.toISOString(),
      }))
      .catch(() => null);
    if (!orderLookup) {
      reservationLookup = await getReservationByToken(codeMatch[1])
        .then((reservation) => ({
          code: reservation.code,
          status: reservation.status,
          startsAt: reservation.startsAt.toISOString(),
          partySize: reservation.partySize,
        }))
        .catch(() => null);
    }
  }

  return {
    restaurant: {
      name: settings.name,
      address: [settings.addressLine1, settings.addressLine2, settings.city].filter(Boolean).join(", "),
      phone: settings.phonePrimary,
      email: settings.emailPublic,
      hours: describeOpeningHours(rules),
      openNow: isOpenAt(now, rules, settings.timezone),
      mapsUrl: settings.mapsUrl,
    },
    ordering: {
      dineIn: settings.allowDineIn,
      takeaway: settings.allowTakeaway,
      delivery: settings.allowDelivery,
      deliveryFee: formatPoisa(settings.deliveryFeePoisa, { symbol: settings.currencySymbol }),
      charges: charges.length > 0 ? charges.join(" and ") : "no service charge or VAT is added",
      payments: `cash, card and mobile banking at the counter; ${
        gateway?.available
          ? `online payment via ${gateway.label}`
          : "no online payment on this site, so bills are settled at the counter"
      }${settings.enablePartialPayments ? "; partial payments are allowed" : "; the full bill must be paid at once"}`,
    },
    reservation: wantsAvailability ? await reservationFactsForChat(dateKey ?? undefined, partySize ?? undefined) : null,
    availability,
    availabilityAskedFor,
    matched: matched.map((item) => item.name),
    items: relevant.map((item) => ({
      name: item.name,
      category: item.category.name,
      priceLabel: formatPoisa(item.pricePoisa, { symbol: settings.currencySymbol }),
      available: item.available,
      description: item.description ?? "",
      ingredients: item.ingredients ?? "",
      allergens: item.allergens ?? "",
    })),
    orderLookup,
    reservationLookup,
  };
}

function factsForPrompt(grounding: Grounding): string {
  const lines: string[] = [
    `Restaurant: ${grounding.restaurant.name}`,
    `Address: ${grounding.restaurant.address || "(not configured yet)"}`,
    `Phone: ${grounding.restaurant.phone || "(not configured yet)"}`,
    `Opening hours: ${grounding.restaurant.hours}`,
    `Currently open: ${grounding.restaurant.openNow ? "yes" : "no"}`,
    `Order channels — dine-in: ${grounding.ordering.dineIn ? "yes" : "no"}, takeaway: ${grounding.ordering.takeaway ? "yes" : "no"}, delivery: ${grounding.ordering.delivery ? "yes" : "no"}`,
    `Charges on the bill: ${grounding.ordering.charges}`,
    `Payments accepted: ${grounding.ordering.payments}`,
  ];

  if (grounding.reservation) {
    const policy = grounding.reservation.policy;
    lines.push(
      `Reservation policy: sittings of ${policy.sittingMinutes} minutes, bookings close ${policy.cutoffMinutes} minutes before seating, up to ${policy.maxDaysAhead} days ahead, ${policy.slotMinutes}-minute slots${
        policy.depositPoisa > 0 ? `, deposit required` : ", no deposit"
      }.`,
    );
  }
  if (grounding.availability && grounding.availabilityAskedFor) {
    const free = grounding.availability.slots.filter((slot) => slot.available).slice(0, 8);
    lines.push(
      `Live availability for ${grounding.availabilityAskedFor.partySize} guests on ${grounding.availabilityAskedFor.dateKey}: ${
        grounding.availability.closed ? "we are closed that day" : free.length > 0 ? free.map((slot) => slot.time).join(", ") : "no free slot left that day"
      }.`,
    );
  }
  if (grounding.orderLookup) {
    lines.push(`Order ${grounding.orderLookup.orderNumber}: status ${grounding.orderLookup.status}, total ${grounding.orderLookup.totalLabel}${grounding.orderLookup.table ? `, table ${grounding.orderLookup.table}` : ""}.`);
  }
  if (grounding.reservationLookup) {
    lines.push(`Booking ${grounding.reservationLookup.code}: status ${grounding.reservationLookup.status} for ${grounding.reservationLookup.partySize} guests.`);
  }
  lines.push("Menu (name | category | price | available | allergens | ingredients):");
  for (const item of grounding.items) {
    lines.push(`- ${item.name} | ${item.category} | ${item.priceLabel} | ${item.available ? "yes" : "no"} | ${item.allergens || "not recorded"} | ${item.ingredients || "not recorded"}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Grounded fallback answers (used when AI is off, unavailable or disabled)
// ---------------------------------------------------------------------------

const ESCALATION_SUGGESTIONS = [
  { label: "Book a table", href: "/reservations" },
  { label: "See the full menu", href: "/menu" },
  { label: "Contact us", href: "/contact" },
];

function itemLine(item: Grounding["items"][number]): string {
  return `${item.name} — ${item.priceLabel}${item.available ? "" : " (currently unavailable)"}`;
}

function answerFromFacts(question: string, grounding: Grounding): { reply: string; answeredBy: ChatAnswer["answeredBy"]; sources: ChatFactSource[] } {
  const lower = question.toLowerCase();
  const currency = "৳";

  if (grounding.orderLookup) {
    const order = grounding.orderLookup;
    const human = order.status.replace("_", " ").toLowerCase();
    return {
      reply: `Order ${order.orderNumber} is ${human}${order.table ? ` for table ${order.table}` : ""}, total ${order.totalLabel}. You can follow every change on your order page.`,
      answeredBy: "order",
      sources: [{ kind: "Order", label: order.orderNumber }],
    };
  }
  if (grounding.reservationLookup) {
    const booking = grounding.reservationLookup;
    return {
      reply: `Booking ${booking.code} is ${booking.status.toLowerCase()} for ${booking.partySize} guests. Open your reservation page for the exact time and table.`,
      answeredBy: "order",
      sources: [{ kind: "Reservation", label: booking.code }],
    };
  }

  // Dish-specific question first: prices and availability are the most common ask.
  if (grounding.matched.length > 0) {
    const matchedItems = grounding.items.filter((item) => grounding.matched.includes(item.name)).slice(0, 6);
    const isAllergen = /allerg|ingredient|contain|gluten|nut|dairy|milk|egg|spicy|heat|vegan|vegetarian|ham|beef|chicken|fish/.test(lower);
    if (isAllergen) {
      const recorded = matchedItems.filter((item) => item.allergens || item.ingredients);
      if (recorded.length === 0) {
        return {
          reply:
            `We have ${matchedItems.map((item) => item.name).join(", ")} on the menu, but the recipe and allergen details are not recorded in our system, ` +
            `so I do not want to guess about something that affects your health. Please ask our kitchen team through a staff member or call ${grounding.restaurant.phone || "us"} and we will confirm.`,
          answeredBy: "menu-data",
          sources: [{ kind: "MenuItem", label: matchedItems.map((item) => item.name).join(", ") }],
        };
      }
      const lines = recorded.map((item) => {
        const parts = [item.allergens ? `allergens: ${item.allergens}` : "allergens not recorded", item.ingredients ? `ingredients: ${item.ingredients}` : "ingredients not recorded"];
        return `${item.name} — ${parts.join("; ")}`;
      });
      return {
        reply: `Here is what we have recorded:\n${lines.join("\n")}\nOur kitchen prepares everything in one line, so we cannot promise a dish is entirely free of cross-contact.`,
        answeredBy: "menu-data",
        sources: [{ kind: "MenuItem", label: recorded.map((item) => item.name).join(", ") }],
      };
    }
    return {
      reply: `${matchedItems.map(itemLine).join("\n")}\nPrices are the same as on the digital menu; service charges follow the restaurant's settings.`,
      answeredBy: "menu-data",
      sources: [{ kind: "MenuItem", label: matchedItems.map((item) => item.name).join(", ") }],
    };
  }

  if (/hour|open|close|timing|what time/.test(lower)) {
    return {
      reply: `${grounding.restaurant.name} opening hours: ${grounding.restaurant.hours}. We are ${grounding.restaurant.openNow ? "open right now" : "closed right now"}.`,
      answeredBy: "settings",
      sources: [{ kind: "RestaurantSettings", label: "openingHours" }],
    };
  }

  if (/where|address|location|direction|how far|map/.test(lower)) {
    if (!grounding.restaurant.address) {
      return {
        reply: "Our address is not configured in the system yet, so I do not want to give you the wrong directions. Please check our contact page or call us.",
        answeredBy: "settings",
        sources: [{ kind: "RestaurantSettings", label: "addressLine1" }],
      };
    }
    return {
      reply: `You can find us at ${grounding.restaurant.address}.${grounding.restaurant.mapsUrl ? ` Directions: ${grounding.restaurant.mapsUrl}` : ""}`,
      answeredBy: "settings",
      sources: [{ kind: "RestaurantSettings", label: "address" }],
    };
  }

  if (/phone|call|contact|whatsapp|email/.test(lower)) {
    const contact = [grounding.restaurant.phone && `phone ${grounding.restaurant.phone}`, grounding.restaurant.email && `email ${grounding.restaurant.email}`].filter(Boolean).join(" or ");
    return {
      reply: contact ? `You can reach us by ${contact}.` : "Our contact details are not configured yet — please use the contact page and we will pick it up there.",
      answeredBy: "settings",
      sources: [{ kind: "RestaurantSettings", label: "contact" }],
    };
  }

  if (/pay|card|bkash|nagad|rocket|cash|online/.test(lower)) {
    return {
      reply: `Payment: ${grounding.ordering.payments}. Bills show ${grounding.ordering.charges}. An online payment only counts once the gateway confirms it — if anything looks unpaid after you paid, tell a staff member and we will match the transaction.`,
      answeredBy: "settings",
      sources: [{ kind: "RestaurantSettings", label: "paymentProvider" }],
    };
  }

  if (/deliver|takeaway|take ?away|pickup|pick ?up/.test(lower)) {
    const options = [grounding.ordering.dineIn && "dine-in", grounding.ordering.takeaway && "takeaway", grounding.ordering.delivery && `delivery (fee ${grounding.ordering.deliveryFee})`].filter(Boolean);
    return {
      reply: options.length > 0 ? `We currently offer ${options.join(", ")}.` : "Order channels are not switched on yet — please order at the counter.",
      answeredBy: "settings",
      sources: [{ kind: "RestaurantSettings", label: "orderChannels" }],
    };
  }

  if (grounding.availability && grounding.availabilityAskedFor) {
    const free = grounding.availability.slots.filter((slot) => slot.available).slice(0, 8);
    const { partySize, dateKey } = grounding.availabilityAskedFor;
    if (grounding.availability.closed) {
      return {
        reply: `We are closed on ${dateKey}, so there is no table to offer. Our usual hours are ${grounding.restaurant.hours}.`,
        answeredBy: "availability",
        sources: [{ kind: "Availability", label: dateKey }],
      };
    }
    if (free.length === 0) {
      return {
        reply: `I cannot find a free table for ${partySize} on ${dateKey}. Walk-ins are always welcome when a table opens up, or try another date on the reservation page.`,
        answeredBy: "availability",
        sources: [{ kind: "Availability", label: dateKey }],
      };
    }
    return {
      reply: `For ${partySize} guests on ${dateKey} these times are free: ${free.map((slot) => slot.time).join(", ")}. Complete the booking on the reservation page — a table is only yours once it is confirmed there.`,
      answeredBy: "availability",
      sources: [{ kind: "Availability", label: `${dateKey} ${partySize}` }],
    };
  }

  if (/reserv|book|table/.test(lower)) {
    const policy = grounding.reservation?.policy;
    return {
      reply:
        `To book a table, use the reservation page — it shows only the slots our system has confirmed as free.` +
        (policy
          ? `\nSittings last ${policy.sittingMinutes} minutes and bookings close ${policy.cutoffMinutes} minutes before the time. You can book up to ${policy.maxDaysAhead} days ahead.${
              policy.depositPoisa > 0 ? ` A deposit of ${formatPoisa(policy.depositPoisa, { symbol: currency })} applies.` : " No deposit is required."
            }`
          : ""),
      answeredBy: "availability",
      sources: [{ kind: "ReservationPolicy", label: "settings" }],
    };
  }

  if (/menu|dish|serve|food|special|popular|recommend|eat/.test(lower)) {
    const categories = new Map<string, number>();
    for (const item of grounding.items) categories.set(item.category, (categories.get(item.category) ?? 0) + 1);
    const highlight = grounding.items.filter((item) => item.available).slice(0, 8).map(itemLine).join("\n");
    return {
      reply: `Our menu has ${[...categories.entries()].map(([name, count]) => `${name} (${count})`).join(", ")}. A few of them:\n${highlight || "The menu is being prepared — please check the menu page."}\nThe full list with photos is on the menu page.`,
      answeredBy: "menu-data",
      sources: [{ kind: "MenuItem", label: `${grounding.items.length} items` }],
    };
  }

  if (/discount|offer|deal|group|party|event|catering|birthday|bulk/.test(lower)) {
    return {
      reply: "Group bookings, celebrations and catering are arranged by our team rather than by a fixed rule, so I will not guess at what we can offer. Please use the contact page or speak to a manager — we will confirm prices and space for you.",
      answeredBy: "staff-handoff",
      sources: [],
    };
  }

  if (/problem|issue|wrong|cold|delay|late|wait|refund|complaint|bad service|hygiene|dirty/.test(lower)) {
    return {
      reply: "I am sorry about that. This needs a person, not an automated answer — please call or ask a manager at the counter and tell them what happened. I have flagged this so the team can follow up.",
      answeredBy: "staff-handoff",
      sources: [],
    };
  }

  if (/hello|hi|hey|salam|assalam|good morning|good evening/.test(lower)) {
    return {
      reply: `Hello — welcome to ${grounding.restaurant.name}. Ask me about dishes and prices, our opening hours, how to pay, or booking a table. I can only tell you what is in our system; anything unusual I will hand to the team.`,
      answeredBy: "settings",
      sources: [],
    };
  }

  return {
    reply: `I can help with our menu and prices, opening hours, payments and booking a table. For everything else it is better to ask our team directly — here is what I know: ${grounding.restaurant.hours}.`,
    answeredBy: "settings",
    sources: [],
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function askChatbot(input: ChatSendInput): Promise<ChatAnswer> {
  const settings = await getSettings();
  if (!settings.chatbotEnabled) {
    throw new AppError("UNAVAILABLE", "The assistant is switched off. Please ask a staff member or use the contact page.");
  }

  const conversation = await ensureConversation(input.conversationToken, input.tableToken);
  await prisma.chatMessage.create({ data: { conversationId: conversation.id, role: "USER", content: input.message } });

  const grounding = await buildGrounding(input.message);
  const ai = aiProviderStatus();
  const useAi = settings.chatbotEnabled && !settings.chatbotFallbackOnly && ai.configured;

  let answer: { reply: string; answeredBy: ChatAnswer["answeredBy"]; sources: ChatFactSource[] };
  let usedFallback = false;
  let notice: string | null = null;
  let model: string | null = null;

  if (useAi) {
    const messages: LlmMessage[] = [
      {
        role: "system",
        content:
          `You are the online host for ${grounding.restaurant.name}, a restaurant in Bangladesh. ` +
          `Answer only from the FACTS block. If a fact is missing, says "(not configured yet)" or "not recorded", say you do not know and suggest asking staff — never invent prices, dishes, ingredients, allergens, timings, addresses or availability. ` +
          `Never claim a booking, order or payment has been made; you cannot perform those actions. ` +
          `Amounts are Bangladeshi Taka. Keep replies under 120 words, plain text, no markdown headings. Do not roleplay or discuss unrelated topics. ` +
          `If the visitor is upset or asks about discounts, catering, large groups, allergies you cannot verify, or a payment problem, tell them a manager will follow up.\n\nFACTS:\n${factsForPrompt(grounding)}`,
      },
      ...(await history(conversation.id)),
      { role: "user" as const, content: input.message },
    ];

    const result = await completeChat(messages, { temperature: 0.2 });
    if (result.ok) {
      answer = {
        reply: result.text,
        answeredBy: grounding.matched.length > 0 ? "menu-data" : "settings",
        sources: [{ kind: "Llm", label: result.model }, ...(grounding.matched.length > 0 ? [{ kind: "MenuItem", label: grounding.matched.join(", ") }] : [])],
      };
      model = result.model;
    } else {
      answer = answerFromFacts(input.message, grounding);
      usedFallback = true;
      notice = aiFallbackNotice(result.reason);
    }
  } else {
    answer = answerFromFacts(input.message, grounding);
    usedFallback = true;
    if (settings.chatbotFallbackOnly) notice = "Answered from our menu and settings.";
    else if (!ai.configured) notice = "Answered from our menu and settings — the AI assistant is not configured.";
  }

  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: answer.reply,
      sourcesJson: answer.sources,
      usedFallback,
    },
  });
  await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { lastActiveAt: new Date(), messageCount: { increment: 1 }, fallbackOnly: usedFallback },
  });

  return {
    conversationToken: conversation.publicToken,
    reply: answer.reply,
    answeredBy: answer.answeredBy,
    usedFallback,
    notice,
    model,
    sources: answer.sources,
    suggestions: ESCALATION_SUGGESTIONS,
  };
}

function aiFallbackNotice(reason: string): string {
  const explanations: Record<string, string> = {
    timeout: "Our smart assistant timed out, so this answer comes straight from our menu and settings.",
    network: "Our smart assistant could not be reached, so this answer comes straight from our menu and settings.",
    "empty-response": "Our smart assistant gave no reply, so this answer comes straight from our menu and settings.",
    "no-provider": "Our smart assistant is not configured, so this answer comes straight from our menu and settings.",
  };
  return explanations[reason] ?? `Our smart assistant is temporarily unavailable (status ${reason}), so this answer comes straight from our menu and settings.`;
}

/** Visitor-initiated hand-off. Records the request and tells the staff inbox. */
export async function escalateConversation(conversationToken: string, reason: string | null) {
  const conversation = await prisma.chatConversation.findUnique({ where: { publicToken: conversationToken } });
  if (!conversation) throw new AppError("NOT_FOUND", "Conversation not found.");
  const updated = await prisma.chatConversation.update({
    where: { id: conversation.id },
    data: { escalatedAt: conversation.escalatedAt ?? new Date(), escalationReason: reason?.slice(0, 300) ?? null },
  });
  await queueNotification({
    type: "CHAT_ESCALATION",
    subject: "A guest asked to speak to a manager",
    // The conversation's public token is what lets *anyone* read that guest's chat,
    // and a notification body is copied into mail servers, inboxes and forwards on the
    // way to staff. They reach the same conversation through the admin panel, which
    // knows who they are, so the token has no business being in this sentence.
    bodyText: `A guest asked for a manager: ${reason ?? "no reason given"}. Open the chat inbox in the admin panel — escalated conversations sit at the top.`,
    relatedKind: "ChatConversation",
    relatedId: conversation.id,
    staffAudience: true,
  });
  return { escalatedAt: updated.escalatedAt, reason: updated.escalationReason };
}

export async function chatTranscript(conversationToken: string) {
  const conversation = await prisma.chatConversation.findUnique({
    where: { publicToken: conversationToken },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) throw new AppError("NOT_FOUND", "Conversation not found.");
  return conversation;
}

export async function listConversations(filters: { escalated?: boolean; from?: Date; to?: Date }, pagination: { skip: number; take: number }) {
  const where = {
    ...(filters.escalated === undefined ? {} : { escalatedAt: filters.escalated ? { not: null } : null }),
    ...(fromTo(filters.from, filters.to)),
  };
  const [rows, total, escalated] = await Promise.all([
    prisma.chatConversation.findMany({
      where,
      orderBy: { lastActiveAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      include: { messages: { orderBy: { createdAt: "desc" }, take: 1, select: { role: true, content: true, createdAt: true } } },
    }),
    prisma.chatConversation.count({ where }),
    prisma.chatConversation.count({ where: { escalatedAt: { not: null } } }),
  ]);
  return {
    conversations: rows.map((row) => ({
      id: row.id,
      publicToken: row.publicToken,
      startedAt: row.startedAt,
      lastActiveAt: row.lastActiveAt,
      messageCount: row.messageCount,
      fallbackOnly: row.fallbackOnly,
      escalatedAt: row.escalatedAt,
      escalationReason: row.escalationReason,
      tableToken: row.tableToken,
      lastMessage: row.messages[0] ?? null,
    })),
    total,
    escalated,
  };
}

function fromTo(from?: Date, to?: Date) {
  if (!from && !to) return {};
  return { lastActiveAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } };
}

export async function chatHealth() {
  const settings = await getSettings();
  const ai = aiProviderStatus();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [conversations, messages, escalated] = await Promise.all([
    prisma.chatConversation.count({ where: { lastActiveAt: { gte: since } } }),
    prisma.chatMessage.count({ where: { createdAt: { gte: since } } }),
    prisma.chatConversation.count({ where: { escalatedAt: { not: null }, lastActiveAt: { gte: since } } }),
  ]);
  return {
    enabled: settings.chatbotEnabled,
    fallbackOnly: settings.chatbotFallbackOnly,
    aiConfigured: ai.configured,
    aiModel: ai.model,
    aiReason: ai.reason,
    conversationsLast24h: conversations,
    messagesLast24h: messages,
    escalationsLast24h: escalated,
  };
}
