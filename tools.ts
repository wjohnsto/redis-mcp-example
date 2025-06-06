import { z } from "zod";
import type { Tool } from "ai";

const zReducerTools = z.object({
  tools: z.array(z.string()).describe("List of tool names that are relevant to the query."),
});

export type ReducerTools = z.infer<typeof zReducerTools>;

export const reducer: Tool & { name: string } = {
  name: "reducer-tool",
  description:
    "Given an existing set of tools, this tool you tell me which tools make sense to use for a given prompt.",
  parameters: zReducerTools,
};
