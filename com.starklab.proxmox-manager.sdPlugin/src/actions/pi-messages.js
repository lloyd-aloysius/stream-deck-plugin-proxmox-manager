/**
 * Shared handler for messages from the Property Inspector. All actions
 * forward their `onSendToPlugin` events here so the PI can rely on a
 * consistent protocol regardless of which action is configured.
 *
 * Supported message payloads (all objects have a `type` discriminator):
 *   { type: 'list-servers' }
 *   { type: 'get-hierarchy', serverId }
 *   { type: 'refresh-hierarchy', serverId }
 *   { type: 'test-connection', config }
 *   { type: 'save-server', config }
 *   { type: 'delete-server', serverId }
 */

import streamDeck from '@elgato/streamdeck';
import { pollManager } from '../api/poll-manager.js';
import * as cache from '../utils/cache.js';
import * as settings from '../utils/settings.js';
import { ProxmoxError } from '../api/proxmox-client.js';

const TAG = '[PI]';

/**
 * Dispatch a message from the PI. Responses are routed via
 * `streamDeck.ui.sendToPropertyInspector`, which sends to whichever PI is
 * currently visible — the SDK v2 replacement for the per-action method.
 */
export async function handlePiMessage(ev) {
	const payload = ev.payload ?? {};
	const send = (response) => streamDeck.ui.sendToPropertyInspector(response);
	try {
		switch (payload.type) {
			case 'list-servers': {
				const servers = await settings.listServers();
				await send({ type: 'servers', servers: servers.map(stripSecret) });
				return;
			}
			case 'get-hierarchy': {
				let hierarchy = cache.getHierarchy(payload.serverId);
				if (!hierarchy) {
					const nodes = await pollManager.refreshHierarchy(payload.serverId);
					hierarchy = { nodes };
				}
				await send({ type: 'hierarchy', serverId: payload.serverId, nodes: hierarchy.nodes });
				return;
			}
			case 'refresh-hierarchy': {
				const nodes = await pollManager.refreshHierarchy(payload.serverId);
				await send({ type: 'hierarchy', serverId: payload.serverId, nodes });
				return;
			}
			case 'test-connection': {
				const result = await pollManager.testConnection(payload.config);
				if (result.ok) {
					await send({ type: 'test-result', ok: true, version: result.data?.version });
				} else {
					await send({ type: 'test-result', ok: false, error: describeError(result.error) });
				}
				return;
			}
			case 'save-server': {
				// If editing, the PI may send `_preserveSecret: true` to mean
				// "keep the existing token secret". Resolve it before writing.
				let config = { ...payload.config };
				if (config._preserveSecret && config.id) {
					const existing = await settings.getServer(config.id);
					if (existing) config.tokenSecret = existing.tokenSecret;
				}
				delete config._preserveSecret;
				const stored = await settings.upsertServer(config);
				// Rebuild poll manager client with new config.
				await pollManager.ensureServer(stored.id);
				const servers = await settings.listServers();
				await send({ type: 'servers', servers: servers.map(stripSecret) });
				await send({ type: 'save-result', ok: true, serverId: stored.id });
				return;
			}
			case 'delete-server': {
				await pollManager.removeServer(payload.serverId);
				await settings.deleteServer(payload.serverId);
				const servers = await settings.listServers();
				await send({ type: 'servers', servers: servers.map(stripSecret) });
				return;
			}
			default:
				streamDeck.logger.warn(`${TAG} unknown message type: ${payload.type}`);
		}
	} catch (err) {
		streamDeck.logger.error(`${TAG} handler error for ${payload.type}`, err);
		await send({ type: 'error', error: describeError(err) });
	}
}

/** Remove the token secret before returning server configs to the PI. */
function stripSecret(server) {
	return { ...server, tokenSecret: server.tokenSecret ? '••••' : '' };
}

function describeError(err) {
	if (err instanceof ProxmoxError) {
		return { kind: err.kind, message: err.message, status: err.status };
	}
	return { kind: 'unknown', message: err?.message ?? String(err) };
}

export { TAG as PI_MESSAGES_TAG };
