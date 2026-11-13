#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  assertConfirmTo,
  assertFromMatchesLine,
  confirmToParamDescription,
  fromParamDescription,
  lineParamDescription,
  missingLineMessage,
  resolveSendingLine,
  sendMessageDescription,
  withSendingLineEcho,
} from "./lines.js";

const API_BASE =
  process.env.QUO_API_BASE ?? process.env.OPENPHONE_API_BASE ?? "https://api.openphone.com/v1";

const QUO_API_VERSION = "2026-03-30";

function normalizeRecipients(to: string | string[]): string[] {
  if (Array.isArray(to)) {
    if (to.length < 1 || to.length > 10) {
      throw new Error("to must contain 1-10 phone numbers");
    }
    return to;
  }

  const trimmed = to.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        if (parsed.length < 1 || parsed.length > 10) {
          throw new Error("to must contain 1-10 phone numbers");
        }
        return parsed.map(String);
      }
    } catch {
      // fall through to single recipient
    }
  }
  return [to];
}

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
      "Quo-Api-Version": QUO_API_VERSION,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenPhone API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

const participantsQueryParam = z.preprocess(
  (val) => {
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed.startsWith("[")) {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // fall through
        }
      }
      return [val];
    }
    return val;
  },
  z.array(z.string())
);

export function createServer(): McpServer {
  const server = new McpServer({
    name: "openphone-mcp",
    version: "1.0.0",
  });

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
    "List SMS messages for a phone number. Requires phoneNumberId and at least one participant number (up to 10 for group threads).",
    {
      phoneNumberId: z.string().describe("OpenPhone number ID (format: PN...)"),
      participants: participantsQueryParam
        .pipe(z.array(z.string()).min(1).max(10))
        .describe("Phone numbers in E.164 format (e.g., +15551234567). 1-10 for group threads."),
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
      if (participants.length > 0) params.participants = participants;
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

  server.tool(
    "send_message",
    sendMessageDescription(),
    {
      line: z.enum(["main", "agent"], { error: missingLineMessage() }).describe(lineParamDescription()),
      from: z.string().optional().describe(fromParamDescription()),
      to: z
        .union([z.string(), z.array(z.string()).min(1).max(10)])
        .describe(
          "Recipient phone number(s) in E.164 format. Single string for 1:1 (e.g., +15551234567) or array of 1-10 numbers for group SMS."
        ),
      content: z.string().min(1).max(1600).describe("Message text (1-1600 characters)"),
      confirmTo: z
        .string()
        .regex(/^\d{4}$/, {
          error:
            "Refusing to send: `confirmTo` must be exactly 4 digits, the last 4 of every recipient. Nothing was sent.",
        })
        .optional()
        .describe(confirmToParamDescription()),
      userId: z.string().optional().describe("User ID sending the message (format: US...)"),
      setInboxStatus: z.enum(["done"]).optional().describe("Set to 'done' to move conversation to Done inbox"),
    },
    async ({ line, from, to, content, confirmTo, userId, setInboxStatus }) => {
      const resolved = resolveSendingLine(line);
      const recipients = normalizeRecipients(to);
      assertConfirmTo(confirmTo, recipients);
      assertFromMatchesLine(from, resolved);

      const body: Record<string, unknown> = {
        from: resolved.id,
        to: recipients,
        content,
      };
      if (userId) body.userId = userId;
      if (setInboxStatus) body.setInboxStatus = setInboxStatus;

      const result = await apiRequest("/messages", { method: "POST", body });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(withSendingLineEcho(result, resolved), null, 2) }],
      };
    }
  );

  server.tool(
    "list_conversations",
    "List conversation threads. Filter by phone numbers, user, or date range.",
    {
      phoneNumbers: participantsQueryParam
        .pipe(z.array(z.string()).max(100))
        .optional()
        .describe("Filter by phone number IDs or E.164 numbers (1-100)"),
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
      if (phoneNumbers && phoneNumbers.length > 0) params.phoneNumbers = phoneNumbers;
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
      participants: participantsQueryParam
        .pipe(z.array(z.string()).min(1).max(1))
        .describe("One participant phone number in E.164 format"),
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
      if (participants.length > 0) params.participants = participants;
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

  return server;
}

async function main() {
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
}

// Importing this module starts stdio, which is how run.mjs loads dist/.
// Tests set OPENPHONE_MCP_NO_AUTOSTART=1 before importing so they can call tools in-process.
if (process.env.OPENPHONE_MCP_NO_AUTOSTART !== "1") {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
