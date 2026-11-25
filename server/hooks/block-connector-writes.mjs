#!/usr/bin/env node
// PreToolUse hook for runs started by Claudiopiloto.
// Exit code 2 blocks the tool call and sends stderr back to Claude.
import { isConnectorWrite } from './connector-policy.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let tool = '';
  try {
    tool = JSON.parse(raw).tool_name ?? '';
  } catch {
    // Unreadable input: block, because this hook only runs for connector tools.
    process.stderr.write('Claudiopiloto: could not read the tool call, so it is blocked.');
    process.exit(2);
  }
  if (isConnectorWrite(tool)) {
    process.stderr.write(
      `Claudiopiloto blocked ${tool}: runs from the dashboard never write to Jira, Slack, Monday or Google. ` +
        'Write a draft (target and exact text) in your final answer so the user can approve and send it.',
    );
    process.exit(2);
  }
  process.exit(0);
});
