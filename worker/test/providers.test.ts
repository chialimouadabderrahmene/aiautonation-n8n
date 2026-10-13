import { describe, it, expect, vi, afterEach } from "vitest";
import { createOpenAICompatible } from "../src/lib/providers/openai-compatible";
import { createAnthropic } from "../src/lib/providers/anthropic";
import { ProviderError } from "../src/lib/http";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("OpenAI-compatible adapter (OpenAI, Groq)", () => {
  it("sends the expected chat-completions request shape and maps the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: '{"ok":true}' } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAICompatible("groq", "Groq", "https://api.groq.com/openai/v1", "gsk_test", "llama-3.3-70b-versatile");
    const result = await provider.chatJSON({ system: "sys", user: "usr", temperature: 0.2 });

    expect(result).toEqual({ raw: '{"ok":true}', provider: "groq", model: "llama-3.3-70b-versatile" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer gsk_test", "Content-Type": "application/json" });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ],
    });
  });

  it("maps a 401 to a non-retryable structured ProviderError and does not retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: "invalid api key" } }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAICompatible("openai", "OpenAI", "https://api.openai.com/v1", "sk_bad", "gpt-4o-mini");
    await expect(provider.chatJSON({ system: "s", user: "u" })).rejects.toMatchObject({
      name: "ProviderError",
      status: 401,
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 500 and succeeds on the next attempt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: "overloaded" }))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: '{"ok":true}' } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAICompatible("openai", "OpenAI", "https://api.openai.com/v1", "sk_ok", "gpt-4o-mini");
    const promise = provider.chatJSON({ system: "s", user: "u" });
    await vi.advanceTimersByTimeAsync(5000);

    await expect(promise).resolves.toEqual({ raw: '{"ok":true}', provider: "openai", model: "gpt-4o-mini" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a retryable ProviderError when the response has no content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: "" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAICompatible("openai", "OpenAI", "https://api.openai.com/v1", "sk_ok", "gpt-4o-mini");
    await expect(provider.chatJSON({ system: "s", user: "u" })).rejects.toMatchObject({
      name: "ProviderError",
      retryable: true,
    });
  });
});

describe("Anthropic adapter", () => {
  it("sends the expected Messages API request shape and maps the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { content: [{ type: "text", text: '{"ok":true}' }] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createAnthropic("sk-ant-test", "claude-sonnet-4-5");
    const result = await provider.chatJSON({ system: "sys", user: "usr", temperature: 0.3 });

    expect(result).toEqual({ raw: '{"ok":true}', provider: "anthropic", model: "claude-sonnet-4-5" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({
      "x-api-key": "sk-ant-test",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-sonnet-4-5");
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(0.3);
    expect(body.system).toContain("sys");
    expect(body.system).toContain("Respond with ONLY the JSON object");
    expect(body.messages).toEqual([{ role: "user", content: "usr" }]);
  });

  it("extracts the text block when multiple content blocks are returned", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { content: [{ type: "thinking", text: "ignored" }, { type: "text", text: '{"ok":true}' }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createAnthropic("sk-ant-test", "claude-sonnet-4-5");
    const result = await provider.chatJSON({ system: "sys", user: "usr" });
    expect(result.raw).toBe('{"ok":true}');
  });

  it("maps a 403 to a non-retryable structured ProviderError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { error: { message: "forbidden" } }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createAnthropic("sk-ant-bad", "claude-sonnet-4-5");
    await expect(provider.chatJSON({ system: "s", user: "u" })).rejects.toMatchObject({
      name: "ProviderError",
      status: 403,
      retryable: false,
    });
  });

  it("throws a retryable ProviderError when no text content block is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { content: [{ type: "thinking" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createAnthropic("sk-ant-ok", "claude-sonnet-4-5");
    await expect(provider.chatJSON({ system: "s", user: "u" })).rejects.toBeInstanceOf(ProviderError);
  });
});
