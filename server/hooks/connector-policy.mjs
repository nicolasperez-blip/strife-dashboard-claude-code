/**
 * Read-only policy for claude.ai connector tools (Jira, Confluence, Slack, Monday, Google).
 * A connector tool is allowed only when its name says it reads. Everything else,
 * including tools added to a connector later, counts as a write and is blocked.
 */
export const CONNECTOR_PREFIX = 'mcp__claude_ai_';

export const READ_RE =
  /^(slack_)?(get|list|read|search|discover|executeRead|atlassianHome|atlassianUserInfo|board_insights|workspace_info|explore_meetings|all_api_read|download|suggest_time)/i;

/** Tool name without the mcp__<server>__ prefix. */
export function shortName(tool) {
  return String(tool).split('__').slice(2).join('__');
}

export function isConnectorWrite(tool) {
  return String(tool).startsWith(CONNECTOR_PREFIX) && !READ_RE.test(shortName(tool));
}
