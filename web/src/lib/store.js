const PREFS_KEY = 'gemini-clone.prefs.v1';

export function uid() {
  // Storage paths and primary keys both use this, so prefer real UUIDs.
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ prefs */

// Only UI preferences stay local now; conversations live in Postgres.

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* non-critical */
  }
}

/* ------------------------------------------------------------------ chats */

/**
 * A chat that exists only in memory until its first message is sent.
 *
 * A `temporary` chat is never persisted at all: it skips every database write,
 * stays out of the sidebar, and is discarded on reload or when another chat is
 * opened.
 */
export function createDraftChat(model, { temporary = false } = {}) {
  const now = Date.now();
  return {
    id: uid(),
    title: temporary ? 'Temporary chat' : 'New chat',
    titleLocked: temporary,
    model,
    createdAt: now,
    updatedAt: now,
    messages: [],
    loaded: true,
    persisted: false,
    temporary,
  };
}

/* --------------------------------------------------------- api conversion */

/**
 * Convert stored messages into Gemini `contents`.
 * Model turns replay their raw parts so thought signatures survive.
 */
export function toGeminiContents(messages) {
  const contents = [];

  for (const message of messages) {
    if (message.error && message.role === 'model') continue;

    if (message.role === 'user') {
      const parts = [];
      for (const attachment of message.attachments || []) {
        if (attachment.data) {
          parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
        }
      }
      if (message.text?.trim()) parts.push({ text: message.text });
      if (parts.length) contents.push({ role: 'user', parts });
      continue;
    }

    const parts = message.parts?.length
      ? message.parts
      : message.text
        ? [{ text: message.text }]
        : [];
    if (parts.length) contents.push({ role: 'model', parts });
  }

  return contents;
}

export function groupChatsByDate(chats) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86400000;

  const buckets = new Map();
  const bucketFor = (timestamp) => {
    if (timestamp >= startOfToday) return 'Today';
    if (timestamp >= startOfToday - dayMs) return 'Yesterday';
    if (timestamp >= startOfToday - dayMs * 7) return 'Previous 7 days';
    if (timestamp >= startOfToday - dayMs * 30) return 'Previous 30 days';
    return 'Older';
  };

  for (const chat of chats) {
    const label = bucketFor(chat.updatedAt || chat.createdAt || 0);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(chat);
  }

  const order = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'];
  return order.filter((label) => buckets.has(label)).map((label) => [label, buckets.get(label)]);
}
