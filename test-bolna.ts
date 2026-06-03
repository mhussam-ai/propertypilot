import { BolnaClient } from "./lib/bolna/client.ts";

async function test() {
  const client = new BolnaClient({ apiKey: "bn-8f0d27ea891841c1b45328bbd6556e7b" });
  try {
    await client.createAgent({
      agent_config: {
        agent_name: "Test Agent",
        agent_welcome_message: "Hello",
        webhook_url: "http://localhost:3000",
        tasks: [
          {
            task_type: "conversation",
            tools_config: {
              llm_agent: {
                agent_type: "simple_llm_agent",
                agent_flow_type: "streaming",
                llm_config: {
                  provider: "openai",
                  model: "gpt-4o-mini",
                },
              },
              transcriber: { provider: "deepgram", model: "nova-3", language: "hi" },
              synthesizer: { 
                provider: "elevenlabs",
                provider_config: {
                  voice: "Anika - Polished Engaging & Helpful",
                  voice_id: "FiIgWdzVKAalJyAgg8Pg",
                  model: "eleven_flash_v2_5"
                }
              },
              input: { provider: "exotel", format: "wav" },
              output: { provider: "exotel", format: "wav" },
            },
            toolchain: { execution: "parallel", pipelines: [["transcriber", "llm", "synthesizer"]] },
          },
        ],
        calling_guardrails: {
          call_start_hour: 9,
          call_end_hour: 20,
        },
      },
      agent_prompts: {
        task_1: { system_prompt: "You are a test agent." },
      },
    });
    console.log("Success!");
  } catch (err: any) {
    console.log(err.message);
  }
}

test();
