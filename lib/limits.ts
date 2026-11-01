/** Contract limits shared by the server, the prompts and the client (SPEC §3). */
export const MAX_DOC_CHARS = 40_000;
export const MAX_INSTRUCTION_CHARS = 500;
export const MAX_EDITS = 5;
export const MAX_REASON_CHARS = 120;
export const MAX_OUTPUT_TOKENS = 1200;
export const UPSTREAM_TIMEOUT_MS = 30_000;
