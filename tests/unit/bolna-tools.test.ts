import { describe, it, expect } from "vitest";
import { buildBookVisitTool } from "@/lib/bolna/tools";

describe("buildBookVisitTool", () => {
  const tool = buildBookVisitTool({
    baseUrl: "https://propertypilot.vercel.app",
    webhookToken: "tok_abc",
    bhkOptions: ["2", "2.5", "3"],
  });

  it('uses the mandatory key "custom_task"', () => {
    expect(tool.key).toBe("custom_task");
  });

  it("declares only the required parameters in `required`", () => {
    expect(tool.parameters.required).toContain("day");
    expect(tool.parameters.required).toContain("time");
    expect(tool.parameters.required).toContain("bhk");
    expect(tool.parameters.required).not.toContain("budget_inr");
    expect(tool.parameters.required).not.toContain("purpose");
  });

  it("lists BHK options inside the bhk parameter description", () => {
    expect(tool.parameters.properties.bhk.description).toContain("2");
    expect(tool.parameters.properties.bhk.description).toContain("3");
  });

  it("uses Bolna format specifiers (%(name)s / %(name)i) in param map", () => {
    expect(tool.value.param.day).toBe("%(day)s");
    expect(tool.value.param.budget_inr).toBe("%(budget_inr)i");
    expect(tool.value.param.execution_id).toBe("%(execution_id)s");
  });

  it("targets the agent-tools/book-visit endpoint", () => {
    expect(tool.value.url).toBe("https://propertypilot.vercel.app/api/v1/agent-tools/book-visit");
  });

  it("passes the per-tenant webhook token as Bearer", () => {
    expect(tool.value.api_token).toBe("Bearer tok_abc");
  });

  it("includes a multilingual pre_call_message map (en + hi at minimum)", () => {
    expect(typeof tool.pre_call_message).toBe("object");
    expect((tool.pre_call_message as Record<string, string>).en).toBeTruthy();
    expect((tool.pre_call_message as Record<string, string>).hi).toBeTruthy();
  });
});
