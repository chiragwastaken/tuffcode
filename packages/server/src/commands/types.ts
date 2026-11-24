/** A slash command: one of the built-ins, or a discovered `.tuffcode/commands/*.md`. */
export interface CommandDefinition {
  name: string;
  description: string;
  /** Prompt template for user commands; empty for built-ins handled by the server. */
  body: string;
  /** Source file, or null for a built-in. */
  path: string | null;
  /** Usage hint from frontmatter, or null when the command takes no arguments. */
  argumentHint: string | null;
}

/**
 * Slash input is either a recognized command invocation or plain text to send to
 * the model. Unknown slash names are plain text so composer input is never lost.
 */
export type ParsedCommand = { name: string; args: string } | { message: string };
