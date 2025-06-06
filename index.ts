import { createAnthropic, type AnthropicProviderOptions } from "@ai-sdk/anthropic";
import {
  experimental_createMCPClient,
  generateText,
  type CoreMessage,
  type Tool,
  type ToolSet,
} from "ai";
import readline from "readline/promises";
import dotenv from "dotenv";
import { reducer, type ReducerTools } from "./tools";

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-3-5-sonnet-20241022";
const REDIS_MCP_SERVER_URL =
  process.env.REDIS_MCP_SERVER_URL || "http://localhost:8000/sse";

if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

const anthropic = createAnthropic({
  apiKey: ANTHROPIC_API_KEY,
});
const model = anthropic(CHAT_MODEL);
const providerOptions = {
  anthropic: {
    thinking: { type: "disabled", budgetTokens: 1000 }
  } satisfies AnthropicProviderOptions,
};

type MCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;

function printTools(tools: ToolSet) {
  return (
    "\n" +
    Object.keys(tools)
      .map((name) => {
        const { description } = tools[name] as Tool;

        const lines = description?.split(/(\r?\n)+/) || [];
        const desc = lines.find((value) => value.trim().length > 0);

        return `\`${name}\`: ${desc || "No description available"}`;
      })
      .join("\n")
  );
}

async function getToolsToUse(client: MCPClient, query: string) {
  const tools = await client.tools();
  const messages: CoreMessage[] = [
    {
      role: "user",
      content: `Given the following query, which tools should I use?
Query: ${query}
Available tools: ${printTools(tools)}
Use '${reducer.name}' to tell me which tools make sense to use. Send only the names of the tools that are relevant to the query.`,
    },
  ];

  const { toolCalls } = await generateText({
    model,
    messages,
    providerOptions,
    tools: {
      [reducer.name]: reducer,
    },
  });

  const availableTools: ToolSet = {};

  for (const { toolName, args } of toolCalls) {
    if (toolName === reducer.name) {
      console.log(`> ${toolName}(${JSON.stringify(args)})`);
      const toolsUsed = (args as ReducerTools).tools;
      if (toolsUsed) {
        for (const tool of toolsUsed) {
          if (tools[tool]) {
            availableTools[tool] = tools[tool];
          }
        }
      }
    }
  }

  return availableTools;
}

async function processQuery(client: MCPClient, query: string) {
  const toolsToUse = await getToolsToUse(client, query);
  console.log(`Using tools:\n${printTools(toolsToUse)}\n`);
  const messages: CoreMessage[] = [
    {
      role: "user",
      content: `Use the tools provided to answer the following query: ${query}`,
    },
  ];

  await generateText({
    model,
    messages,
    providerOptions,
    maxSteps: 1000,
    onStepFinish({ text, toolCalls }) {
      let message = [];

      if (text.trim().length > 0) {
        message.push(text.trim());
      }

      for (const { toolName, args } of toolCalls) {
        message.push(`> ${toolName}(${JSON.stringify(args)})`);
      }

      if (message.length > 0) {
        console.log(message.join("\n"));
      }
    },
    tools: toolsToUse,
  });
}

async function chatLoop(client: MCPClient) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("\nMCP Client Started!");
    console.log("Type your queries or 'quit' to exit.");
    console.log("Type 'tools' to see a list of available tools.");

    while (true) {
      const message = await rl.question("\nQuery: ");
      if (message.toLowerCase() === "quit") {
        break;
      }

      if (message.toLowerCase() === "tools") {
        console.log(printTools(await client.tools()));
        continue;
      }

      await processQuery(client, message);
    }
  } catch (error) {
    console.error("An error occurred during the chat loop:", error);
    throw error;
  } finally {
    rl.close();
  }
}

let mcpClient: MCPClient | null = null;

async function cleanup(client: MCPClient | null) {
  if (client) {
    try {
      await client.close();
    } catch (error) { console.log(error); }
  }
}

try {
  mcpClient = await experimental_createMCPClient({
    name: "mcp-client-cli",
    transport: {
      type: "sse",
      url: REDIS_MCP_SERVER_URL,
    },
  });

  await chatLoop(mcpClient);
} catch (error) {
  await cleanup(mcpClient);
  process.exit(1);
} finally {
  await cleanup(mcpClient);
  process.exit(0);
}
