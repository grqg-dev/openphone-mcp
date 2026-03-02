#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "https://api.openphone.com/v1";

function getApiKey(): string {
  const key = process.env.OPENPHONE_API_KEY;
  if (!key) {
    throw new Error(
      "OPENPHONE_API_KEY environment variable is required. " +
        "Get your API key from https://app.openphone.com/settings/api-keys"
    );
  }
  return key;
}

async function apiRequest(
  path: string,
  options: { method?: string; params?: Record<string, string | string[] | undefined>; body?: unknown } = {}
): Promise<unknown> {
  const { method = "GET", params, body } = options;
  const url = new URL(`${API_BASE}${path}`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          url.searchParams.append(key, v);
        }
      } else {
        url.searchParams.set(key, value);
      }
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: getApiKey(),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenPhone API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

const server = new McpServer({
  name: "openphone-mcp",
  version: "1.0.0",
});

// --- Phase 1: Read SMS ---

server.tool(
  "get_phone_numbers",
  "List all phone numbers in the OpenPhone workspace. Optionally filter by user ID.",
  { userId: z.string().optional().describe("Filter by user ID (format: US...)") },
  async ({ userId }) => {
    const params: Record<string, string | undefined> = {};
    if (userId) params.userId = userId;

    const result = await apiRequest("/phone-numbers", { params });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_messages",
  "List SMS messages for a phone number. Requires phoneNumberId and at least one participant number.",
  {
    phoneNumberId: z.string().describe("OpenPhone number ID (format: PN...)"),
    participants: z.array(z.string()).describe("Phone numbers in E.164 format (e.g., +15551234567)"),
    maxResults: z.number().min(1).max(100).default(20).describe("Max results per page (1-100)"),
    userId: z.string().optional().describe("Filter by sender user ID (format: US...)"),
    createdAfter: z.string().optional().describe("ISO 8601 timestamp — only messages after this time"),
    createdBefore: z.string().optional().describe("ISO 8601 timestamp — only messages before this time"),
    pageToken: z.string().optional().describe("Pagination token from previous response"),
  },
  async ({ phoneNumberId, participants, maxResults, userId, createdAfter, createdBefore, pageToken }) => {
    const params: Record<string, string | string[] | undefined> = {
      phoneNumberId,
      maxResults: String(maxResults),
    };
    // participants needs to be sent as repeated query params
    if (participants.length > 0) params["participants[]"] = participants;
    if (userId) params.userId = userId;
    if (createdAfter) params.createdAfter = createdAfter;
    if (createdBefore) params.createdBefore = createdBefore;
    if (pageToken) params.pageToken = pageToken;

    const result = await apiRequest("/messages", { params });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_message",
  "Get a specific message by its ID.",
  { messageId: z.string().describe("Message ID (format: AC...)") },
  async ({ messageId }) => {
    const result = await apiRequest(`/messages/${messageId}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Phase 2: Send, Conversations, Calls ---

server.tool(
  "send_message",
  "Send an SMS from an OpenPhone number. Costs ~$0.01/segment.",
  {
    from: z.string().describe("Sender: OpenPhone number ID (PN...) or E.164 phone number"),
    to: z.string().describe("Recipient phone number in E.164 format (e.g., +15551234567)"),
    content: z.string().min(1).max(1600).describe("Message text (1-1600 characters)"),
    userId: z.string().optional().describe("User ID sending the message (format: US...)"),
    setInboxStatus: z.enum(["done"]).optional().describe("Set to 'done' to move conversation to Done inbox"),
  },
  async ({ from, to, content, userId, setInboxStatus }) => {
    const body: Record<string, unknown> = { from, to: [to], content };
    if (userId) body.userId = userId;
    if (setInboxStatus) body.setInboxStatus = setInboxStatus;

    const result = await apiRequest("/messages", { method: "POST", body });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_conversations",
  "List conversation threads. Filter by phone numbers, user, or date range.",
  {
    phoneNumbers: z.array(z.string()).optional().describe("Filter by phone number IDs or E.164 numbers (1-100)"),
    userId: z.string().optional().describe("Filter by user ID (format: US...)"),
    createdAfter: z.string().optional().describe("ISO 8601 timestamp"),
    createdBefore: z.string().optional().describe("ISO 8601 timestamp"),
    updatedAfter: z.string().optional().describe("ISO 8601 timestamp"),
    updatedBefore: z.string().optional().describe("ISO 8601 timestamp"),
    excludeInactive: z.boolean().optional().describe("Exclude inactive conversations"),
    maxResults: z.number().min(1).max(100).default(20).describe("Max results per page (1-100)"),
    pageToken: z.string().optional().describe("Pagination token from previous response"),
  },
  async ({
    phoneNumbers,
    userId,
    createdAfter,
    createdBefore,
    updatedAfter,
    updatedBefore,
    excludeInactive,
    maxResults,
    pageToken,
  }) => {
    const params: Record<string, string | string[] | undefined> = {
      maxResults: String(maxResults),
    };
    if (phoneNumbers && phoneNumbers.length > 0) params["phoneNumbers[]"] = phoneNumbers;
    if (userId) params.userId = userId;
    if (createdAfter) params.createdAfter = createdAfter;
    if (createdBefore) params.createdBefore = createdBefore;
    if (updatedAfter) params.updatedAfter = updatedAfter;
    if (updatedBefore) params.updatedBefore = updatedBefore;
    if (excludeInactive !== undefined) params.excludeInactive = String(excludeInactive);
    if (pageToken) params.pageToken = pageToken;

    const result = await apiRequest("/conversations", { params });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_calls",
  "List call history for a phone number. Requires phoneNumberId and one participant.",
  {
    phoneNumberId: z.string().describe("OpenPhone number ID (format: PN...)"),
    participants: z.array(z.string()).max(1).describe("One participant phone number in E.164 format"),
    maxResults: z.number().min(1).max(100).default(20).describe("Max results per page (1-100)"),
    userId: z.string().optional().describe("Filter by user ID (format: US...)"),
    createdAfter: z.string().optional().describe("ISO 8601 timestamp"),
    createdBefore: z.string().optional().describe("ISO 8601 timestamp"),
    pageToken: z.string().optional().describe("Pagination token from previous response"),
  },
  async ({ phoneNumberId, participants, maxResults, userId, createdAfter, createdBefore, pageToken }) => {
    const params: Record<string, string | string[] | undefined> = {
      phoneNumberId,
      maxResults: String(maxResults),
    };
    if (participants.length > 0) params["participants[]"] = participants;
    if (userId) params.userId = userId;
    if (createdAfter) params.createdAfter = createdAfter;
    if (createdBefore) params.createdBefore = createdBefore;
    if (pageToken) params.pageToken = pageToken;

    const result = await apiRequest("/calls", { params });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_call",
  "Get details of a specific call by its ID.",
  { callId: z.string().describe("Call ID (format: AC...)") },
  async ({ callId }) => {
    const result = await apiRequest(`/calls/${callId}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
