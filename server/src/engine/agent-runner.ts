import { Pool } from 'pg';

/**
 * Agent runner has been disabled.
 * Agent trades are now executed directly by the user's wallet on the frontend.
 * This module is kept as a stub to avoid breaking imports.
 */

export function startAgentRunner(_db: Pool, _intervalMs: number = 60000): NodeJS.Timeout {
  console.info('[agent-runner] Disabled — agent trades are now executed via frontend wallet');
  // Return a no-op interval that does nothing
  return setInterval(() => {}, 2147483647);
}
