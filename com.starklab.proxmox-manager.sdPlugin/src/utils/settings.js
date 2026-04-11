/**
 * Global settings helpers. The plugin stores all server configurations
 * in Stream Deck's global settings JSON so that every action instance
 * can reference any server by id.
 *
 * Shape:
 *   {
 *     servers: {
 *       [serverId]: {
 *         id, name, host, tokenId, tokenSecret, verifySSL,
 *         statusPollSeconds, statsPollSeconds
 *       }
 *     }
 *   }
 */

import streamDeck from '@elgato/streamdeck';
import {
	DEFAULT_STATUS_POLL_SECONDS,
	DEFAULT_STATS_POLL_SECONDS
} from './constants.js';

const TAG = '[Settings]';

/** Returns the full global settings object, defaulted. */
export async function getGlobalSettings() {
	const raw = (await streamDeck.settings.getGlobalSettings()) ?? {};
	if (!raw.servers) raw.servers = {};
	return raw;
}

/** Returns the list of configured servers as an array sorted by name. */
export async function listServers() {
	const settings = await getGlobalSettings();
	return Object.values(settings.servers).sort((a, b) =>
		a.name.localeCompare(b.name)
	);
}

/** Returns a single server config by id, or undefined. */
export async function getServer(serverId) {
	if (!serverId) return undefined;
	const settings = await getGlobalSettings();
	return settings.servers[serverId];
}

/**
 * Inserts or updates a server config. If no id is provided, a new UUID
 * is generated. Returns the stored config.
 */
export async function upsertServer(config) {
	const settings = await getGlobalSettings();
	const id = config.id ?? generateId();
	const stored = {
		id,
		name: String(config.name ?? '').trim(),
		host: String(config.host ?? '').trim(),
		tokenId: String(config.tokenId ?? '').trim(),
		tokenSecret: String(config.tokenSecret ?? '').trim(),
		verifySSL: Boolean(config.verifySSL),
		statusPollSeconds: Number(config.statusPollSeconds) || DEFAULT_STATUS_POLL_SECONDS,
		statsPollSeconds: Number(config.statsPollSeconds) || DEFAULT_STATS_POLL_SECONDS
	};
	settings.servers[id] = stored;
	await streamDeck.settings.setGlobalSettings(settings);
	streamDeck.logger.info(`${TAG} upsert server ${id} (${stored.name})`);
	return stored;
}

/** Removes a server config by id. */
export async function deleteServer(serverId) {
	const settings = await getGlobalSettings();
	if (!settings.servers[serverId]) return false;
	delete settings.servers[serverId];
	await streamDeck.settings.setGlobalSettings(settings);
	streamDeck.logger.info(`${TAG} deleted server ${serverId}`);
	return true;
}

/** Generates a short random id. Good enough for internal keys. */
function generateId() {
	return 'srv-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
