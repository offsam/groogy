/**
 * Turn raw duplicate-scan reason codes into moderator-facing Russian labels.
 * Client-safe — no server-only imports.
 */

export type DuplicateMatchLabel = {
  /** Short signal type, e.g. «Совпал телефон». */
  kindLabelRu: string;
  /** Highlighted value, e.g. «+1 786-750-7987». */
  valueLabel: string | null;
  /** One-line summary for the badge. */
  summaryRu: string;
  /** Contact/exact identity vs weak name/cluster. */
  exact: boolean;
  /** Second line: the same field exists on the current card. */
  onThisCardHint: string | null;
};

export type CardMatchSignals = {
  phones?: string[] | null;
  telegramUsername?: string | null;
  telegramUserId?: string | null;
  instagram?: string[] | null;
  website?: string[] | null;
  names?: string[] | null;
};

function phoneDigits(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length >= 10 ? d.slice(-10) : d;
}

function formatPhoneDisplay(raw: string): string {
  const ten = phoneDigits(raw);
  if (ten.length === 10) {
    return `+1 ${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
  }
  return raw.trim() || raw;
}

function cardHasPhone(
  signals: CardMatchSignals | null | undefined,
  value: string,
): boolean {
  const want = phoneDigits(value);
  if (!want || want.length < 10) return false;
  return (signals?.phones || []).some((p) => phoneDigits(p) === want);
}

function cardHasTelegram(
  signals: CardMatchSignals | null | undefined,
  handle: string,
): boolean {
  const want = handle.replace(/^@/, "").toLowerCase();
  const have = (signals?.telegramUsername || "").replace(/^@/, "").toLowerCase();
  return Boolean(want && have && want === have);
}

function cardHasTelegramUserId(
  signals: CardMatchSignals | null | undefined,
  id: string,
): boolean {
  const want = id.trim();
  const have = String(signals?.telegramUserId || "").trim();
  return Boolean(want && have && want === have);
}

function stripPrefix(reason: string): {
  body: string;
  isRecommendation: boolean;
  isQueue: boolean;
} {
  let body = reason.trim();
  let isRecommendation = false;
  let isQueue = false;
  if (/^рекомендация\s*·\s*/i.test(body)) {
    isRecommendation = true;
    body = body.replace(/^рекомендация\s*·\s*/i, "").trim();
  }
  if (/^в\s+очереди\s*·\s*/i.test(body)) {
    isQueue = true;
    body = body.replace(/^в\s+очереди\s*·\s*/i, "").trim();
  }
  return { body, isRecommendation, isQueue };
}

function withScope(
  label: string,
  opts: { isRecommendation: boolean; isQueue: boolean },
): string {
  if (opts.isRecommendation) return `Рекомендация · ${label.toLowerCase()}`;
  if (opts.isQueue) return `В очереди · ${label.toLowerCase()}`;
  return label;
}

/**
 * Parse a scan `reason` string into a human-readable badge payload.
 */
export function parseDuplicateMatchReason(
  reason: string | null | undefined,
  card?: CardMatchSignals | null,
): DuplicateMatchLabel {
  const raw = (reason || "").trim();
  if (!raw) {
    return {
      kindLabelRu: "Совпадение",
      valueLabel: null,
      summaryRu: "Совпадение",
      exact: false,
      onThisCardHint: null,
    };
  }

  const { body, isRecommendation, isQueue } = stripPrefix(raw);
  const scope = { isRecommendation, isQueue };

  const phoneM = body.match(/^phone:\s*(.+)$/i);
  if (phoneM) {
    const value = formatPhoneDisplay(phoneM[1]!.trim());
    const kindLabelRu = withScope("Совпал телефон", scope);
    const onCard =
      !card || cardHasPhone(card, phoneM[1]!)
        ? "тот же номер есть на этой карточке"
        : null;
    return {
      kindLabelRu,
      valueLabel: value,
      summaryRu: `${kindLabelRu} ${value}`,
      exact: true,
      onThisCardHint: onCard,
    };
  }

  const tgM = body.match(/^telegram:@?([A-Za-z0-9_]+)(?:\s*→\s*\w+)?$/i);
  if (tgM) {
    const handle = `@${tgM[1]}`;
    const kindLabelRu = withScope("Тот же Telegram", scope);
    const onCard =
      !card || cardHasTelegram(card, tgM[1]!)
        ? "тот же @ник есть на этой карточке"
        : null;
    return {
      kindLabelRu,
      valueLabel: handle,
      summaryRu: `${kindLabelRu} ${handle}`,
      exact: true,
      onThisCardHint: onCard,
    };
  }

  const tgIdM = body.match(/^telegram_user_id:\s*(.+)$/i);
  if (tgIdM) {
    const id = tgIdM[1]!.trim();
    const kindLabelRu = withScope("Тот же Telegram user id", scope);
    const onCard =
      !card || cardHasTelegramUserId(card, id)
        ? "тот же Telegram user id есть на этой карточке"
        : null;
    return {
      kindLabelRu,
      valueLabel: id,
      summaryRu: `${kindLabelRu} ${id}`,
      exact: true,
      onThisCardHint: onCard,
    };
  }

  const igM = body.match(/^instagram:@?(.+)$/i);
  if (igM) {
    const handle = `@${igM[1]!.replace(/^@/, "").trim()}`;
    const kindLabelRu = withScope("Тот же Instagram", scope);
    return {
      kindLabelRu,
      valueLabel: handle,
      summaryRu: `${kindLabelRu} ${handle}`,
      exact: true,
      onThisCardHint: "тот же Instagram есть на этой карточке",
    };
  }

  const webM = body.match(/^website:\s*(.+)$/i);
  if (webM) {
    const host = webM[1]!.trim();
    const kindLabelRu = withScope("Тот же сайт", scope);
    return {
      kindLabelRu,
      valueLabel: host,
      summaryRu: `${kindLabelRu} ${host}`,
      exact: true,
      onThisCardHint: "тот же сайт есть на этой карточке",
    };
  }

  const nameM = body.match(/^name:\s*(.+)$/i);
  if (nameM) {
    const name = nameM[1]!.trim();
    const kindLabelRu = withScope("То же название", scope);
    return {
      kindLabelRu,
      valueLabel: name,
      summaryRu: `${kindLabelRu}: ${name}`,
      exact: false,
      onThisCardHint: null,
    };
  }

  if (/^normalized_name$/i.test(body)) {
    const kindLabelRu = withScope("То же название", scope);
    return {
      kindLabelRu,
      valueLabel: null,
      summaryRu: kindLabelRu,
      exact: false,
      onThisCardHint: null,
    };
  }

  const clusterM = body.match(/^recurring_cluster(?::\s*(.+))?$/i);
  if (clusterM) {
    const id = clusterM[1]?.trim() || null;
    const kindLabelRu = withScope("Тот же кластер объявлений", scope);
    return {
      kindLabelRu,
      valueLabel: id,
      summaryRu: id ? `${kindLabelRu}: ${id.slice(0, 24)}` : kindLabelRu,
      exact: false,
      onThisCardHint: null,
    };
  }

  // Queue twin prose already in Russian.
  if (/тот же телефон/i.test(body)) {
    const kindLabelRu = withScope("Совпал телефон", scope);
    return {
      kindLabelRu,
      valueLabel: null,
      summaryRu: kindLabelRu,
      exact: true,
      onThisCardHint: "тот же номер есть на этой карточке",
    };
  }
  if (/тот же telegram/i.test(body)) {
    const kindLabelRu = withScope("Тот же Telegram", scope);
    return {
      kindLabelRu,
      valueLabel: null,
      summaryRu: kindLabelRu,
      exact: true,
      onThisCardHint: "тот же @ник есть на этой карточке",
    };
  }
  if (/повтор/i.test(body)) {
    const kindLabelRu = withScope("Повтор объявления", scope);
    return {
      kindLabelRu,
      valueLabel: null,
      summaryRu: kindLabelRu,
      exact: false,
      onThisCardHint: null,
    };
  }

  return {
    kindLabelRu: isRecommendation
      ? "Рекомендация"
      : isQueue
        ? "В очереди"
        : "Совпадение",
    valueLabel: body,
    summaryRu: raw,
    exact: false,
    onThisCardHint: null,
  };
}
