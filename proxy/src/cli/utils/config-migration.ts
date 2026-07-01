import fs from 'fs';
import path from 'path';
import { USER_CONFIG_DIR, USER_ENV_PATH, ENV_PATH, ENV_EXAMPLE } from './paths.js';
import { logger } from '../../logger.js';

/**
 * Migrate config from package directory to user home (~/.antigravity/.env).
 *
 * Migration logic:
 * 1. If user config exists → use it (skip migration)
 * 2. If package .env exists → copy to user home
 * 3. If neither exists → copy .env.example to user home
 *
 * Returns the path to the active config file.
 */
export function migrateConfig(): string {
  // Ensure user config directory exists
  if (!fs.existsSync(USER_CONFIG_DIR)) {
    fs.mkdirSync(USER_CONFIG_DIR, { recursive: true });
  }

  // Case 1: User config already exists → use it
  if (fs.existsSync(USER_ENV_PATH)) {
    logger.debug(`[config-migration] Using existing user config at ${USER_ENV_PATH}`);
    return USER_ENV_PATH;
  }

  // Case 2: Package .env exists → copy to user home
  if (fs.existsSync(ENV_PATH)) {
    logger.info(`[config-migration] Migrating config from ${ENV_PATH} to ${USER_ENV_PATH}`);
    fs.copyFileSync(ENV_PATH, USER_ENV_PATH);
    return USER_ENV_PATH;
  }

  // Case 3: Neither exists → copy .env.example to user home
  if (fs.existsSync(ENV_EXAMPLE)) {
    logger.info(`[config-migration] Creating initial config at ${USER_ENV_PATH} from template`);
    fs.copyFileSync(ENV_EXAMPLE, USER_ENV_PATH);
    return USER_ENV_PATH;
  }

  // Fallback: no config available
  logger.warn(`[config-migration] No config source found, using package path as fallback`);
  return ENV_PATH;
}
