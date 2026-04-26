import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import type { Agent } from "../../src/agent/agent"
import { NamedError } from "@opencode-ai/core/util/error"
import { Skill } from "../../src/skill"
import { Permission } from "../../src/permission"
import { SystemPrompt } from "../../src/session/system"
import { testEffect } from "../lib/effect"
import type { Provider } from "../../src/provider"

function makeModel(overrides: Partial<Provider.Model> & { api: Provider.Model["api"] }): Provider.Model {
  const { api, ...rest } = overrides
  return {
    id: "test-model" as any,
    providerID: "test-provider" as any,
    name: "Test Model",
    api,
    capabilities: {
      temperature: false,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-01-01",
    ...rest,
  }
}

const skills: Skill.Info[] = [
  {
    name: "zeta-skill",
    description: "Zeta skill.",
    location: "/tmp/zeta-skill/SKILL.md",
    content: "# zeta-skill",
  },
  {
    name: "alpha-skill",
    description: "Alpha skill.",
    location: "/tmp/alpha-skill/SKILL.md",
    content: "# alpha-skill",
  },
  {
    name: "middle-skill",
    description: "Middle skill.",
    location: "/tmp/middle-skill/SKILL.md",
    content: "# middle-skill",
  },
]

const build: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const it = testEffect(
  SystemPrompt.layer.pipe(
    Layer.provide(
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: (name) => Effect.succeed(skills.find((skill) => skill.name === name)),
          all: () => Effect.succeed(skills),
          dirs: () => Effect.succeed([]),
          available: () => Effect.succeed(skills),
        }),
      ),
    ),
  ),
)

describe("session.system", () => {
  it.effect("skills output is sorted by name and stable across calls", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service
      const first = yield* prompt.skills(build)
      const second = yield* prompt.skills(build)
      const output = first ?? (yield* Effect.fail(new NamedError.Unknown({ message: "missing skills output" })))

      expect(first).toBe(second)

      const alpha = output.indexOf("<name>alpha-skill</name>")
      const middle = output.indexOf("<name>middle-skill</name>")
      const zeta = output.indexOf("<name>zeta-skill</name>")

      expect(alpha).toBeGreaterThan(-1)
      expect(middle).toBeGreaterThan(alpha)
      expect(zeta).toBeGreaterThan(middle)
    }),
  )
})

describe("SystemPrompt.provider", () => {
  test("returns custom prompt when model has prompt field", () => {
    const model = makeModel({
      api: { id: "some-unknown-model", url: "", npm: "" },
      prompt: "You are a custom coding assistant.",
    })
    const result = SystemPrompt.provider(model)
    expect(result).toEqual(["You are a custom coding assistant."])
  })

  test("custom prompt takes priority over model ID matching", () => {
    const model = makeModel({
      api: { id: "claude-sonnet-4", url: "", npm: "" },
      prompt: "Custom prompt overrides claude matching.",
    })
    const result = SystemPrompt.provider(model)
    expect(result).toEqual(["Custom prompt overrides claude matching."])
  })

  test("falls back to claude prompt when no custom prompt and model ID contains claude", () => {
    const model = makeModel({
      api: { id: "claude-sonnet-4", url: "", npm: "" },
    })
    const result = SystemPrompt.provider(model)
    expect(result.length).toBe(1)
    expect(result[0]).not.toBe("")
    const fallbackModel = makeModel({
      api: { id: "some-unknown-model", url: "", npm: "" },
    })
    const fallback = SystemPrompt.provider(fallbackModel)
    expect(result[0]).not.toBe(fallback[0])
  })

  test("falls back to gemini prompt for gemini models", () => {
    const model = makeModel({
      api: { id: "gemini-pro", url: "", npm: "" },
    })
    const result = SystemPrompt.provider(model)
    expect(result.length).toBe(1)
    expect(result[0]).not.toBe("")
  })

  test("falls back to default prompt for unknown models without custom prompt", () => {
    const model = makeModel({
      api: { id: "totally-unknown-model", url: "", npm: "" },
    })
    const result = SystemPrompt.provider(model)
    expect(result.length).toBe(1)
    expect(result[0]).not.toBe("")
  })

  test("model without prompt field uses default matching", () => {
    const model = makeModel({
      api: { id: "gpt-5-turbo", url: "", npm: "" },
    })
    const result = SystemPrompt.provider(model)
    expect(result.length).toBe(1)
    const fallbackModel = makeModel({
      api: { id: "unknown", url: "", npm: "" },
    })
    const fallback = SystemPrompt.provider(fallbackModel)
    expect(result[0]).not.toBe(fallback[0])
  })
})
