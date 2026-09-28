/**
 * What the person said about their idea: the messages that shaped Scry's
 * understanding of it (the first description and any details added, not
 * greetings, follow-up questions or "go ahead"; everything they said if
 * nothing was searched), and that latest understanding.
 */
export function ideaFromConversation(
  messages: { role: string; content: string; searchQuery?: string | null }[],
): { said: string[]; understood: string | null } {
  const said: string[] = [];
  const all: string[] = [];
  let understood: string | null = null;
  messages.forEach((m, i) => {
    if (m.role === "user") {
      all.push(m.content);
      const reply = messages[i + 1];
      if (reply?.role === "assistant" && reply.searchQuery && reply.searchQuery !== understood) {
        said.push(m.content);
      }
    } else if (m.role === "assistant" && m.searchQuery) {
      understood = m.searchQuery;
    }
  });
  return { said: said.length ? said : all, understood };
}
