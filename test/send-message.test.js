import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Recipients are fake ZZTEST numbers only. fetch is replaced and pointed at a closed local port.
const ZZTEST_A = "+1ZZTEST0100";
const ZZTEST_B = "+1ZZTEST20100";
const ZZTEST_C = "+1ZZTEST0101";
const ZZTEST_CONTENT = "ZZTEST";

const MAIN = {
  key: "main",
  name: "Dr Ray - Main",
  number: "(805) 364-0996",
  e164: "+18053640996",
  id: "PNMCqbEJB7",
};
const AGENT = {
  key: "agent",
  name: "Agent line",
  number: "(805) 892-6412",
  e164: "+18058926412",
  id: "PNMb6TbOHu",
};

process.env.QUO_API_BASE = "http://127.0.0.1:9";
process.env.OPENPHONE_API_BASE = "http://127.0.0.1:9";
process.env.OPENPHONE_API_KEY = "ZZTEST";
process.env.OPENPHONE_MCP_NO_AUTOSTART = "1";

const { createServer } = await import("../dist/index.js");

const calls = [];

function installFetchMock() {
  return mock.method(globalThis, "fetch", async (url, init) => {
    const href = String(url);
    if (/api\.openphone\.com|api\.quo\.com/i.test(href)) {
      throw new Error(`refusing real API call: ${href}`);
    }
    calls.push({ url: href, init });
    return new Response(JSON.stringify({ data: { id: "ZZTEST", status: "queued" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

let fetchMock;

before(() => {
  fetchMock = installFetchMock();
});

after(() => {
  fetchMock.mock.restore();
});

beforeEach(() => {
  calls.length = 0;
  fetchMock.mock.resetCalls();
});

function sentRequests() {
  return calls.map((call) => ({
    url: call.url,
    method: call.init?.method,
    headers: call.init?.headers,
    body: call.init?.body ? JSON.parse(call.init.body) : undefined,
  }));
}

function assertNothingSent() {
  assert.equal(calls.length, 0, "HTTP was called");
  assert.equal(fetchMock.mock.calls.length, 0, "fetch was called");
}

async function withClient(fn) {
  const server = createServer();
  const client = new Client({ name: "zztest", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function resultText(result) {
  const block = result.content?.find((item) => item.type === "text");
  return block?.text ?? "";
}

async function callSend(args) {
  return withClient((client) => client.callTool({ name: "send_message", arguments: args }));
}

function assertEcho(payload, line) {
  assert.equal(payload.sentFromLine, `${line.name}, ${line.number}, ${line.id}`);
  assert.equal(payload.line, line.key);
  assert.equal(payload.lineName, line.name);
  assert.equal(payload.lineNumber, line.number);
  assert.equal(payload.lineE164, line.e164);
  assert.equal(payload.lineId, line.id);
  assert.equal(payload.data.id, "ZZTEST");
}

function assertPostedFrom(line, recipients) {
  const [request] = sentRequests();
  assert.equal(sentRequests().length, 1);
  assert.equal(request.method, "POST");
  assert.equal(new URL(request.url).hostname, "127.0.0.1");
  assert.equal(new URL(request.url).pathname, "/messages");
  assert.equal(request.headers.Authorization, "ZZTEST");
  assert.equal(request.body.from, line.id);
  assert.deepEqual(request.body.to, recipients);
  assert.equal(request.body.content, ZZTEST_CONTENT);
  assert.doesNotMatch(request.url, /openphone\.com|quo\.com/i);
}

function assertNamesBothLines(text) {
  assert.match(text, /Nothing was sent/);
  assert.match(text, new RegExp(MAIN.name));
  assert.match(text, new RegExp(MAIN.number.replace(/[()]/g, "\\$&")));
  assert.match(text, new RegExp(MAIN.id));
  assert.match(text, new RegExp(AGENT.name));
  assert.match(text, new RegExp(AGENT.number.replace(/[()]/g, "\\$&")));
  assert.match(text, new RegExp(AGENT.id));
}

describe("send_message schema", () => {
  it("describes both lines and does not name a default", async () => {
    const tools = await withClient(async (client) => {
      const listed = await client.listTools();
      return listed.tools;
    });
    const tool = tools.find((item) => item.name === "send_message");
    assert.ok(tool, "send_message is registered");
    const described = JSON.stringify(tool);

    assert.match(described, /Dr Ray - Main/);
    assert.match(described, /\(805\) 364-0996/);
    assert.match(described, /PNMCqbEJB7/);
    assert.match(described, /patient and customer texts/i);
    assert.match(described, /Agent line/);
    assert.match(described, /\(805\) 892-6412/);
    assert.match(described, /PNMb6TbOHu/);
    assert.match(described, /Internal only: Matt, Julia and staff/);
    assert.match(described, /no default line/i);
    assert.doesNotMatch(described, /practice default/i);

    assert.deepEqual(tool.inputSchema.properties.line.enum, ["main", "agent"]);
    assert.ok(tool.inputSchema.required.includes("line"));
    assert.equal(tool.inputSchema.required.includes("from"), false);
    assert.equal(tool.inputSchema.required.includes("confirmTo"), false);
    assert.ok(tool.inputSchema.properties.to);
    assert.ok(tool.inputSchema.properties.confirmTo);
  });

  it("does not leave the old default wording in the source or README", () => {
    for (const file of ["../src/index.ts", "../src/lines.ts", "../dist/index.js", "../dist/lines.js", "../README.md"]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      assert.doesNotMatch(text, /Practice default/);
    }
  });
});

describe("send_message rejects before HTTP", () => {
  it("rejects a missing line and sends nothing", async () => {
    const result = await callSend({ to: ZZTEST_A, content: ZZTEST_CONTENT });
    assert.equal(result.isError, true);
    const text = resultText(result);
    assert.match(text, /line` is required/);
    assert.match(text, /no default line/i);
    assertNamesBothLines(text);
    assertNothingSent();
  });

  it("rejects a missing line even when from is the main id", async () => {
    const result = await callSend({ from: MAIN.id, to: ZZTEST_A, content: ZZTEST_CONTENT });
    assert.equal(result.isError, true);
    assert.match(resultText(result), /Nothing was sent/);
    assertNothingSent();
  });

  it("rejects an unknown line name", async () => {
    const result = await callSend({ line: "practice", to: ZZTEST_A, content: ZZTEST_CONTENT });
    assert.equal(result.isError, true);
    assert.match(resultText(result), /Nothing was sent/);
    assertNothingSent();
  });

  it("rejects from when it is the other line's phone-number id", async () => {
    const result = await callSend({
      line: "main",
      from: AGENT.id,
      to: ZZTEST_A,
      content: ZZTEST_CONTENT,
    });
    assert.equal(result.isError, true);
    const text = resultText(result);
    assert.match(text, /`line` is main/);
    assert.match(text, /`from` is agent/);
    assertNamesBothLines(text);
    assertNothingSent();
  });

  it("rejects from when it is the other line's E.164 number", async () => {
    const result = await callSend({
      line: "agent",
      from: MAIN.e164,
      to: ZZTEST_A,
      content: ZZTEST_CONTENT,
    });
    assert.equal(result.isError, true);
    const text = resultText(result);
    assert.match(text, /`line` is agent/);
    assert.match(text, /`from` is main/);
    assertNamesBothLines(text);
    assertNothingSent();
  });

  it("rejects from when it matches neither line", async () => {
    const result = await callSend({
      line: "main",
      from: "PNZZTEST",
      to: ZZTEST_A,
      content: ZZTEST_CONTENT,
    });
    assert.equal(result.isError, true);
    const text = resultText(result);
    assert.match(text, /PNZZTEST/);
    assert.match(text, /matches neither line/);
    assertNamesBothLines(text);
    assertNothingSent();
  });

  it("rejects confirmTo when it does not match the recipient", async () => {
    const result = await callSend({
      line: "main",
      to: ZZTEST_A,
      confirmTo: "0101",
      content: ZZTEST_CONTENT,
    });
    assert.equal(result.isError, true);
    const text = resultText(result);
    assert.match(text, /confirmTo` is 0101/);
    assert.match(text, /ZZTEST0100/);
    assert.match(text, /Nothing was sent/);
    assertNothingSent();
  });

  it("rejects confirmTo when any group recipient does not match", async () => {
    const result = await callSend({
      line: "main",
      to: [ZZTEST_A, ZZTEST_C],
      confirmTo: "0100",
      content: ZZTEST_CONTENT,
    });
    assert.equal(result.isError, true);
    const text = resultText(result);
    assert.match(text, /ZZTEST0101/);
    assert.match(text, /Nothing was sent/);
    assertNothingSent();
  });
});

describe("send_message sends only after the line checks pass", () => {
  it("sends from main when from is omitted and echoes that line", async () => {
    const result = await callSend({ line: "main", to: ZZTEST_A, content: ZZTEST_CONTENT });
    assert.notEqual(result.isError, true);
    assertPostedFrom(MAIN, [ZZTEST_A]);
    assertEcho(JSON.parse(resultText(result)), MAIN);
  });

  it("accepts from as the main phone-number id", async () => {
    const result = await callSend({
      line: "main",
      from: MAIN.id,
      to: ZZTEST_A,
      content: ZZTEST_CONTENT,
    });
    assert.notEqual(result.isError, true);
    assertPostedFrom(MAIN, [ZZTEST_A]);
    assert.equal(JSON.parse(resultText(result)).lineId, MAIN.id);
  });

  it("accepts from as the main E.164 number and still posts the phone-number id", async () => {
    const result = await callSend({
      line: "main",
      from: MAIN.e164,
      to: ZZTEST_A,
      content: ZZTEST_CONTENT,
    });
    assert.notEqual(result.isError, true);
    assertPostedFrom(MAIN, [ZZTEST_A]);
    assertEcho(JSON.parse(resultText(result)), MAIN);
  });

  it("accepts a formatted E.164 number for the same line", async () => {
    const result = await callSend({
      line: "main",
      from: "+1 (805) 364-0996",
      to: ZZTEST_A,
      content: ZZTEST_CONTENT,
    });
    assert.notEqual(result.isError, true);
    assertPostedFrom(MAIN, [ZZTEST_A]);
  });

  it("accepts from as the agent id or agent E.164 and echoes the agent line", async () => {
    const byId = await callSend({
      line: "agent",
      from: AGENT.id,
      to: ZZTEST_A,
      content: ZZTEST_CONTENT,
    });
    assert.notEqual(byId.isError, true);
    assertPostedFrom(AGENT, [ZZTEST_A]);
    assertEcho(JSON.parse(resultText(byId)), AGENT);

    calls.length = 0;
    const byNumber = await callSend({
      line: "agent",
      from: "+1 805-892-6412",
      to: ZZTEST_A,
      content: ZZTEST_CONTENT,
    });
    assert.notEqual(byNumber.isError, true);
    assertPostedFrom(AGENT, [ZZTEST_A]);
    assertEcho(JSON.parse(resultText(byNumber)), AGENT);
  });

  it("sends a group when confirmTo matches every recipient", async () => {
    const recipients = [ZZTEST_A, ZZTEST_B];
    const result = await callSend({
      line: "main",
      to: recipients,
      confirmTo: "0100",
      content: ZZTEST_CONTENT,
    });
    assert.notEqual(result.isError, true);
    assertPostedFrom(MAIN, recipients);
    assertEcho(JSON.parse(resultText(result)), MAIN);
  });

  it("keeps a group array working when confirmTo is omitted", async () => {
    const recipients = [ZZTEST_A, ZZTEST_C];
    const result = await callSend({
      line: "agent",
      to: recipients,
      content: ZZTEST_CONTENT,
    });
    assert.notEqual(result.isError, true);
    assertPostedFrom(AGENT, recipients);
    assertEcho(JSON.parse(resultText(result)), AGENT);
  });

  it("still accepts a JSON-string group and checks confirmTo against each number", async () => {
    const recipients = [ZZTEST_A, ZZTEST_B];
    const result = await callSend({
      line: "main",
      to: JSON.stringify(recipients),
      confirmTo: "0100",
      content: ZZTEST_CONTENT,
    });
    assert.notEqual(result.isError, true);
    assertPostedFrom(MAIN, recipients);
  });
});
