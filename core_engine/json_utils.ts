/**
 * Tolerant JSON parsing for LLM outputs that occasionally wrap their JSON
 * in fences or trail explanatory text.
 */
export function parseJsonValue(text: string): any {
  const trimmed = (text || '').trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    const match =
      trimmed.match(/```(?:json)?\s*([\s\S]*?)```/) ||
      trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) return {};
    try {
      return JSON.parse(match[1]);
    } catch {
      return {};
    }
  }
}
