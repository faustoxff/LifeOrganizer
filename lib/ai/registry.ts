import "server-only";
import type { ModelTier, ProviderAdapter } from "@/lib/ai/types";
import { groqProvider } from "@/lib/ai/providers/groq";
import { ollamaProvider } from "@/lib/ai/providers/ollama";

/**
 * Every provider the product knows about, in default preference order.
 *
 * Groq stays first because it is fast and free while the daily budget lasts.
 * Ollama Cloud is second because it has no daily cliff. The order is
 * overridable with `AI_PROVIDER_ORDER` so the eval can pin one provider and
 * measure a change without the other one's behaviour muddying the result.
 */
const ALL_PROVIDERS: ProviderAdapter[] = [groqProvider, ollamaProvider];

export function getProviderChain(): ProviderAdapter[] {
  const configured = process.env.AI_PROVIDER_ORDER?.trim();
  if (!configured) return ALL_PROVIDERS;

  const requested = configured
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);

  // Silently dropping an unknown id would leave the product on one provider
  // with no hint why, so unknown entries are reported and skipped.
  const ordered = requested
    .map((id) => ALL_PROVIDERS.find((provider) => provider.id === id))
    .filter((provider): provider is ProviderAdapter => Boolean(provider));

  const unknown = requested.filter((id) => !ALL_PROVIDERS.some((p) => p.id === id));
  if (unknown.length > 0) {
    console.warn(`[ai] AI_PROVIDER_ORDER lists unknown providers, ignoring: ${unknown.join(", ")}`);
  }

  return ordered.length > 0 ? ordered : ALL_PROVIDERS;
}

/**
 * Whether any configured provider can read images. False today: the adapters send
 * text-only messages. The project flow asks this so it can leave images out and say
 * so, instead of accepting a file it would silently ignore.
 */
export function chainSupportsVision(): boolean {
  return getProviderChain().some((provider) => provider.configured() && provider.supportsVision === true);
}

/**
 * Whether at least one configured provider can take tools with the model it would use
 * for `tier`. False sends Milo down the TASKS_ACTION text path instead.
 */
export function chainSupportsTools(tier: ModelTier): boolean {
  return getProviderChain().some(
    (provider) => provider.configured() && provider.supportsTools?.(provider.modelFor(tier)) === true
  );
}

/**
 * The chain, re-ordered to start just after `providerId`.
 *
 * Used when a reply comes back unusable — empty, or cut off mid-`TASKS_ACTION`
 * block. That is a property of the model that produced it, so retrying against
 * the same engine tends to reproduce it; starting after the provider that
 * failed gives the retry a genuinely different model to try.
 */
export function rotateAfter(providerId: string): string[] {
  const chain = getProviderChain().map((provider) => provider.id);
  const index = chain.indexOf(providerId);
  if (index === -1) return chain;
  return [...chain.slice(index + 1), ...chain.slice(0, index + 1)];
}
