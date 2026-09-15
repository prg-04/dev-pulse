import "server-only";

import type { LanguageModel, EmbeddingModel } from "ai";

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

export type SupportedProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "deepseek"
  | "openrouter"
  | "ollama"
  | "generic";

const OPENAI_COMPATIBLE_PROVIDERS = new Set<SupportedProvider>([
  "deepseek",
  "openrouter",
  "ollama",
  "generic",
]);

const DEFAULT_BASE_URL: Record<SupportedProvider, string | undefined> = {
  openai: undefined,
  anthropic: undefined,
  google: undefined,
  mistral: undefined,
  deepseek: "https://api.deepseek.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
  generic: "",
};

const DEFAULT_MODEL: Record<SupportedProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-5",
  google: "gemini-2.5-flash",
  mistral: "mistral-large-latest",
  deepseek: "deepseek-chat",
  openrouter: "openai/gpt-4o-mini",
  ollama: "llama3.1",
  generic: "gpt-4o-mini",
};

const DEFAULT_EMBEDDING_MODEL: Record<SupportedProvider, string> = {
  openai: "text-embedding-3-small",
  anthropic: "claude-3-5-haiku-20241022", // Anthropic embedding model ID
  google: "gemini-embedding-001",
  mistral: "mistral-embed",
  deepseek: "text-embedding-3-small",
  openrouter: "text-embedding-3-small",
  ollama: "nomic-embed-text",
  generic: "text-embedding-3-small",
};

const PROVIDER_API_KEY_ENV: Record<SupportedProvider, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  ollama: [],
  generic: ["OPENAI_API_KEY"],
};

function normalizeProvider(raw: string | undefined): SupportedProvider {
  if (!raw) return "openai";
  const v = raw.trim().toLowerCase();
  // aliases
  if (v === "claude") return "anthropic";
  if (v === "gemini") return "google";
  if (v === "moonshot" || v === "kimi") return "openrouter"; // use openai-compatible path
  if (v === "xai" || v === "grok") return "openrouter"; // use openai-compatible path
  if (v === "zhipu" || v === "glm") return "openrouter"; // use openai-compatible path
  if (v === "perplexity") return "openrouter"; // use openai-compatible path
  if (v === "nvidia") return "openrouter"; // use openai-compatible path
  if (v === "cerebras") return "openrouter"; // use openai-compatible path
  if (v === "minimax") return "openrouter"; // use openai-compatible path
  if (v === "opencode") return "openrouter"; // use openai-compatible path
  if (["openai", "anthropic", "google", "mistral", "deepseek", "openrouter", "ollama", "generic"].includes(v)) {
    return v as SupportedProvider;
  }
  // unknown -> treat as generic openai-compatible
  return "generic";
}

export function resolveProvider(): SupportedProvider {
  const raw =
    process.env.AI_PROVIDER ||
    process.env.AI_MODEL?.split("/")[0]?.split(":")[0]?.trim() ||
    (process.env.ANTHROPIC_API_KEY ? "anthropic" : undefined) ||
    (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY ? "google" : undefined) ||
    (process.env.MISTRAL_API_KEY ? "mistral" : undefined) ||
    (process.env.DEEPSEEK_API_KEY ? "deepseek" : undefined) ||
    (process.env.OPENROUTER_API_KEY ? "openrouter" : undefined) ||
    (process.env.OPENAI_API_KEY ? "openai" : undefined);
  return normalizeProvider(raw);
}

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function envTrim(name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

export function getProviderMeta(): {
  provider: SupportedProvider;
  model: string;
  embeddingModel: string;
  baseURL: string | undefined;
  apiKey: string | undefined;
} {
  const provider = resolveProvider();

  const model =
    envTrim("AI_MODEL") ||
    envTrim("AI_MODEL_GENERATION") ||
    envTrim(`${provider.toUpperCase()}_MODEL`) ||
    DEFAULT_MODEL[provider];

  const embeddingModel =
    envTrim("AI_MODEL_EMBEDDING") ||
    envTrim(`${provider.toUpperCase()}_EMBEDDING_MODEL`) ||
    DEFAULT_EMBEDDING_MODEL[provider];

  const baseURL =
    envTrim("AI_BASE_URL") ||
    envTrim(`${provider.toUpperCase()}_BASE_URL`) ||
    (provider === "ollama" ? envTrim("OLLAMA_BASE_URL") : undefined) ||
    (provider === "openai" ? envTrim("OPENAI_BASE_URL") : undefined) ||
    DEFAULT_BASE_URL[provider];

  // Resolve API key
  const genericKey = envTrim("AI_API_KEY") || envTrim("OPENAI_API_KEY");
  const providerKeys = PROVIDER_API_KEY_ENV[provider] || [];
  const apiKey =
    genericKey ||
    providerKeys.map((k) => envTrim(k)).find((k) => k !== undefined) ||
    (OPENAI_COMPATIBLE_PROVIDERS.has(provider) ? envTrim("OPENAI_API_KEY") : undefined);

  return { provider, model, embeddingModel, baseURL: baseURL || undefined, apiKey };
}

// ---------------------------------------------------------------------------
// Model factories
// ---------------------------------------------------------------------------

export async function createTextModel(): Promise<LanguageModel> {
  const { provider, model, baseURL, apiKey } = getProviderMeta();
  const key = apiKey || "not-needed";

  // Google
  if (provider === "google") {
    try {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const client = createGoogleGenerativeAI({ apiKey: key });
      // client(model) returns LanguageModelV4
      return client(model) as unknown as LanguageModel;
    } catch {
      // fallback to openai-compatible if SDK missing
    }
  }

  // Anthropic
  if (provider === "anthropic") {
    try {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const client = createAnthropic({ apiKey: key });
      return client(model) as unknown as LanguageModel;
    } catch {
      // fallback
    }
  }

  // Mistral
  if (provider === "mistral") {
    try {
      const { createMistral } = await import("@ai-sdk/mistral");
      const client = createMistral({ apiKey: key });
      return client(model) as unknown as LanguageModel;
    } catch {
      // fallback
    }
  }

  // OpenAI-compatible path (openai, deepseek, openrouter, ollama, generic)
  const { createOpenAI } = await import("@ai-sdk/openai");
  const effectiveBase = baseURL || (provider === "openai" ? undefined : DEFAULT_BASE_URL[provider]);
  const client = createOpenAI({
    apiKey: key,
    baseURL: effectiveBase || undefined,
  });

  if (provider === "openai") {
    return client(model) as unknown as LanguageModel;
  }

  // DeepSeek, OpenRouter, Ollama, generic: use chat() for /chat/completions
  return (client as unknown as { chat: (id: string) => LanguageModel }).chat(model);
}

export async function createEmbeddingModel(): Promise<EmbeddingModel> {
  const { provider, embeddingModel, baseURL, apiKey } = getProviderMeta();
  const key = apiKey || "not-needed";

  // Google
  if (provider === "google") {
    try {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const client = createGoogleGenerativeAI({ apiKey: key });
      return client.embedding(embeddingModel) as unknown as EmbeddingModel;
    } catch {
      // fallback
    }
  }

  // Anthropic
  if (provider === "anthropic") {
    try {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const client = createAnthropic({ apiKey: key });
      return client.embeddingModel(embeddingModel) as unknown as EmbeddingModel;
    } catch {
      // fallback
    }
  }

  // Mistral
  if (provider === "mistral") {
    try {
      const { createMistral } = await import("@ai-sdk/mistral");
      const client = createMistral({ apiKey: key });
      return client.embedding(embeddingModel) as unknown as EmbeddingModel;
    } catch {
      // fallback
    }
  }

  // OpenAI-compatible path
  const { createOpenAI } = await import("@ai-sdk/openai");
  const effectiveBase = baseURL || (provider === "openai" ? undefined : DEFAULT_BASE_URL[provider]);
  const client = createOpenAI({
    apiKey: key,
    baseURL: effectiveBase || undefined,
  });
  return client.embedding(embeddingModel) as unknown as EmbeddingModel;
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

export function assertProviderConfig(): void {
  const provider = resolveProvider();
  if (provider === "ollama") return;
  const { apiKey } = getProviderMeta();
  if (!apiKey) {
    const hint =
      provider === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : provider === "google"
          ? "GOOGLE_GENERATIVE_AI_API_KEY"
          : provider === "mistral"
            ? "MISTRAL_API_KEY"
            : provider === "deepseek"
              ? "DEEPSEEK_API_KEY"
              : provider === "openrouter"
                ? "OPENROUTER_API_KEY"
                : "AI_API_KEY / OPENAI_API_KEY";
    throw Object.assign(new Error(`Missing ${hint} for provider ${provider}`), { statusCode: 500 });
  }
}
