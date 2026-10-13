// In-memory transcript of a call, kept in CONVERSATION order.
//
// The Realtime API does not deliver transcripts in the order people spoke: the caller's
// transcription finishes asynchronously and often arrives AFTER the agent has already
// answered (OpenAI documents that completion order isn't guaranteed and recommends
// matching by `item_id`). Appending on arrival produced summaries where the agent
// "replied" before the caller had spoken.
//
// So each conversation item reserves its slot when it is created (caller: audio buffer
// committed; agent: response output item added), and its text fills that slot whenever
// the transcript arrives. Text with an unknown item id is appended as a fallback.
//
// PRIVACY (D11): lives in memory only, for the duration of the call.

export function createTranscriptLog() {
  let order = [];
  let entries = new Map();
  let looseSeq = 0;

  return {
    /** Reserves the slot of a conversation item, in the order items are created. */
    reserve(itemId, role) {
      if (!itemId || entries.has(itemId)) return;
      entries.set(itemId, { role, text: '' });
      order.push(itemId);
    },
    /** Adds transcript text for an item (fills its reserved slot if there is one). */
    add(role, text, itemId) {
      const clean = (text || '').trim();
      if (!clean) return;
      const entry = itemId ? entries.get(itemId) : undefined;
      if (entry) {
        entry.text = entry.text ? `${entry.text} ${clean}` : clean;
        return;
      }
      const key = itemId || `loose-${(looseSeq += 1)}`;
      entries.set(key, { role, text: clean });
      order.push(key);
    },
    /** Turns with text, in conversation order. */
    toTurns() {
      return order
        .map((key) => entries.get(key))
        .filter((e) => e && e.text)
        .map(({ role, text }) => ({ role, text }));
    },
    /** Drops everything (called once the summary has taken the turns). */
    clear() {
      order = [];
      entries = new Map();
    },
  };
}
