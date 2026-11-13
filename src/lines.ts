/**
 * The only map from a send_message `line` name to a Quo / OpenPhone number.
 * There is no default. A send must name `main` or `agent`.
 */
export const SENDING_LINES = {
  main: {
    key: "main",
    name: "Dr Ray - Main",
    number: "(805) 364-0996",
    e164: "+18053640996",
    id: "PNMCqbEJB7",
    audience: "Used for patient and customer texts.",
  },
  agent: {
    key: "agent",
    name: "Agent line",
    number: "(805) 892-6412",
    e164: "+18058926412",
    id: "PNMb6TbOHu",
    audience: "Internal only: Matt, Julia and staff.",
  },
} as const;

export type LineKey = keyof typeof SENDING_LINES;
export type SendingLine = (typeof SENDING_LINES)[LineKey];

export class SendRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendRejectedError";
  }
}

export function lineSummary(line: SendingLine): string {
  return `${line.name}, ${line.number}, ${line.id}`;
}

export function bothLinesSentence(): string {
  const main = SENDING_LINES.main;
  const agent = SENDING_LINES.agent;
  return `main is ${lineSummary(main)}. agent is ${lineSummary(agent)}.`;
}

export function missingLineMessage(): string {
  return (
    'Refusing to send: `line` is required and must be "main" or "agent". ' +
    `${bothLinesSentence()} There is no default line. Nothing was sent.`
  );
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function samePhone(from: string, e164: string): boolean {
  const fromDigits = digits(from);
  const lineDigits = digits(e164);
  if (!fromDigits || !lineDigits) return false;
  if (fromDigits === lineDigits) return true;
  return lineDigits.startsWith("1") && lineDigits.length === 11 && fromDigits === lineDigits.slice(1);
}

export function identifyLine(from: string): SendingLine | undefined {
  const trimmed = from.trim();
  if (!trimmed) return undefined;
  const lines = Object.values(SENDING_LINES);
  if (/^PN/i.test(trimmed)) {
    return lines.find((line) => line.id === trimmed);
  }
  return lines.find((line) => samePhone(trimmed, line.e164));
}

export function fromMismatchMessage(line: SendingLine, from: string): string {
  const trimmed = from.trim();
  const matched = identifyLine(trimmed);
  const fromPart = matched
    ? `${matched.key} (${lineSummary(matched)})`
    : `"${trimmed}" (matches neither line)`;
  return (
    `Refusing to send: \`line\` is ${line.key} (${lineSummary(line)}) but \`from\` is ${fromPart}. ` +
    `${bothLinesSentence()} Nothing was sent.`
  );
}

export function resolveSendingLine(line: string | undefined): SendingLine {
  if (line !== "main" && line !== "agent") {
    throw new SendRejectedError(missingLineMessage());
  }
  return SENDING_LINES[line];
}

export function assertFromMatchesLine(from: string | undefined, line: SendingLine): void {
  if (from === undefined || from.trim() === "") return;
  const matched = identifyLine(from);
  if (matched?.key === line.key) return;
  throw new SendRejectedError(fromMismatchMessage(line, from));
}

function last4(phone: string): string {
  return digits(phone).slice(-4);
}

export function assertConfirmTo(confirmTo: string | undefined, recipients: string[]): void {
  if (confirmTo === undefined) return;
  if (!/^\d{4}$/.test(confirmTo)) {
    throw new SendRejectedError(
      "Refusing to send: `confirmTo` must be exactly 4 digits, the last 4 of every recipient. Nothing was sent."
    );
  }
  const mismatches = recipients.filter((recipient) => last4(recipient) !== confirmTo);
  if (mismatches.length === 0) return;
  throw new SendRejectedError(
    `Refusing to send: \`confirmTo\` is ${confirmTo} but these recipients do not end in those digits: ${mismatches.join(", ")}. Nothing was sent.`
  );
}

export function sendingLineFields(line: SendingLine): {
  sentFromLine: string;
  line: LineKey;
  lineName: string;
  lineNumber: string;
  lineE164: string;
  lineId: string;
} {
  return {
    sentFromLine: lineSummary(line),
    line: line.key,
    lineName: line.name,
    lineNumber: line.number,
    lineE164: line.e164,
    lineId: line.id,
  };
}

export function withSendingLineEcho(result: unknown, line: SendingLine): Record<string, unknown> {
  const echo = sendingLineFields(line);
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), ...echo };
  }
  return { result, ...echo };
}

export function sendMessageDescription(): string {
  const main = SENDING_LINES.main;
  const agent = SENDING_LINES.agent;
  return [
    "Send an SMS from a named Quo / OpenPhone line. There is no default line.",
    `main: ${main.name}, ${main.number}, id ${main.id}. ${main.audience}`,
    `agent: ${agent.name}, ${agent.number}, id ${agent.id}. ${agent.audience}`,
    "Required `line` is resolved on the server to that line's phone-number id, and the message is sent from that id.",
    "If `from` is also passed, it must be the same line, given as that line's phone-number id or its E.164 number. A missing `line`, or a `from` that does not match `line`, is rejected and nothing is sent.",
    "Optional `confirmTo` is the last 4 digits of the recipient. If it is set and does not match every number in `to`, nothing is sent.",
    "`to` is one E.164 number, or an array of 1-10 numbers for a group SMS.",
    "The result echoes the sending line's name, number, and id.",
  ].join("\n");
}

export function lineParamDescription(): string {
  const main = SENDING_LINES.main;
  const agent = SENDING_LINES.agent;
  return (
    'Required sending line: "main" or "agent". No default. ' +
    `main: ${main.name}, ${main.number}, id ${main.id}. ${main.audience} ` +
    `agent: ${agent.name}, ${agent.number}, id ${agent.id}. ${agent.audience}`
  );
}

export function fromParamDescription(): string {
  const main = SENDING_LINES.main;
  const agent = SENDING_LINES.agent;
  return (
    "Optional. If passed, must match `line`: that line's phone-number id or its E.164 number. " +
    `main is ${main.id} or ${main.e164}. agent is ${agent.id} or ${agent.e164}. ` +
    "There is no default line. If this does not match `line`, nothing is sent."
  );
}

export function confirmToParamDescription(): string {
  return "Optional. Last 4 digits of the recipient. If set, every number in `to` must end in these digits, including a group send, or nothing is sent.";
}
