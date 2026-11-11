/**
 * Membership served before the first successful discovery, and when CommandCode is
 * unreachable. One cheap chat model that exists in both catalog views, so an
 * offline start still has something usable.
 */
export const FALLBACK: readonly string[] = ["deepseek/deepseek-v4.1-flash"];
