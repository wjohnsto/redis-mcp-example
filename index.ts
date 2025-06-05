import { Anthropic } from "@anthropic-ai/sdk";
import {
  type MessageParam,
  type Tool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";
import type { ContentBlock } from "@anthropic-ai/sdk/resources.js";

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = process.env.REDIS_PORT;
const REDIS_USERNAME = process.env.REDIS_USERNAME || "";
const REDIS_PWD = process.env.REDIS_PWD || "";

if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

class MCPClient {
  private mcp: Client;
  private anthropic: Anthropic;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
  }

  async connectToServer() {
    try {
      this.transport = new StdioClientTransport({
        command: "docker",
        args: [
          "run",
          "--rm",
          "--name",
          "redis-mcp-server",
          "-i",
          "-e",
          `REDIS_HOST=${REDIS_HOST}`,
          "-e",
          `REDIS_PORT=${REDIS_PORT}`,
          "-e",
          `REDIS_USERNAME=${REDIS_USERNAME}`,
          "-e",
          `REDIS_PWD=${REDIS_PWD}`,
          "mcp/redis",
        ],
      });
      this.mcp.connect(this.transport);
    } catch (error) {
      console.error("Error connecting to MCP server:", error);
      throw error;
    }
  }

  async getToolsToUse(query: string): Promise<Tool[]> {
    const messages: MessageParam[] = [
      {
        role: "user",
        content: `Given the following query, which tools should I use?
Query: ${query}
Available tools: ${this.printTools()}
Use the 'inform-tool' tool to tell me which tools make sense to use. Send only the names of the tools that are relevant to the query.`,
      },
    ];

    const response = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      messages,
      tools: [this.getToolFactory()],
    });
    let availableTools: Tool[] = [];

    for (const content of response.content) {
      if (content.type === "tool_use" && content.name === "inform-tool") {
        const tools = content.input as { tools: string[] } | undefined;
        availableTools = this.tools.filter((tool) =>
          tools?.tools.includes(tool.name),
        );
      }
    }

    return availableTools;
  }

  sortResult(content: ContentBlock[]): ContentBlock[] {
    if (content.length < 2) {
      return content;
    }
    const [result1, result2] = content;

    if (!result1 || !result2) {
      return content;
    }

    if (result1.type === "text" && result2.type === "tool_use") {
      return [result1, result2];
    } else if (result1.type === "tool_use" && result2.type === "text") {
      return [result2, result1];
    }

    return content;
  }

  async processQuery(query: string) {
    const toolsToUse = await this.getToolsToUse(query);
    toolsToUse.push(this.getFinalTool());
    const messages: MessageParam[] = [
      {
        role: "user",
        content: "You are a helpful assistant. Use the tools provided to answer the query. Once you're done call the 'final_tool' to indicate that you have made all the necessary tool calls."
      },
      {
        role: "user",
        content: query,
      },
    ];

    const response = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      messages,
      tools: toolsToUse,
    });

    const finalText = [];

    response.content = this.sortResult(response.content);

    while (response.content.length > 0) {
      const content = response.content.shift();

      if (!content) {
        break;
      }

      if (content.type === "text") {
        finalText.push(content.text);

        messages.push({
          role: "assistant",
          content: content.text
        });
      } else if (content.type === "tool_use") {
        const toolName = content.name;
        messages.push({
          role: "assistant",
          content: [content]
        });

        if (toolName === "final-tool") {
          const finalResponse = content.input as { final_response: string };
          finalText.push(finalResponse.final_response);
          break;
        }

        const toolArgs = content.input as { [x: string]: unknown } | undefined;

        const result = await this.mcp.callTool({
          name: toolName,
          arguments: toolArgs,
        });

        messages.push({
          role: "user",
          content: [{
            tool_use_id: content.id,
            type: 'tool_result',
            content: result.content as string,
          }],
        });

        const nextResponse = await this.anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1000,
          messages,
          tools: toolsToUse,
        });
        nextResponse.content = this.sortResult(nextResponse.content);

        response.content.push(...nextResponse.content)
      }
    }

    return finalText.join("\n");
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client Started!");
      console.log("Type your queries or 'quit' to exit.");
      console.log("Type 'tools' to see a list of available tools.")

      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }

        if (message.toLowerCase() === "tools") {
          console.log(this.printTools());
          continue;
        }

        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } catch (error) {
      console.error("An error occurred during the chat loop:", error);
      throw error;
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    await this.mcp.close();
  }

  getFinalTool(): Tool {
    return {
      name: "final-tool",
      description: "This tool is used to finalize the response after all tools have been executed.",
      input_schema: {
        type: "object",
        properties: {
          final_response: {
            type: "string",
            description: "The final response after executing all relevant tools.",
          },
        },
      },
    };
  }

  getToolFactory(): Tool {
    return {
      name: "inform-tool",
      description: "Given an existing set of tools, this tool you tell me which tools make sense to use for a given prompt.",
      input_schema: {
        type: "object",
        properties: {
          tools: {
            type: "array",
            items: {
              type: "string",
            },
            description: "List of tool names that are relevant to the query.",
          }
        }
      }
    }
  }

  async addTools() {
    const toolsResult = await this.mcp.listTools();
    this.tools = toolsResult.tools.map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      };
    });
  }

  printTools(tools?: Tool[]) {
    let toolsToPrint = tools || this.tools;
    return "\n" + toolsToPrint.map(({ name, description }) => `\`${name}\`: ${description?.split(/\r?\n/)[0]}`).join("\n");
  }
}

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const mcpClient = new MCPClient();
  try {
    await mcpClient.connectToServer();
    await wait(10000);
    await mcpClient.addTools();
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
