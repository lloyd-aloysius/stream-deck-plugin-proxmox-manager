/**
 * Plugin entry point.
 *
 * Registers all 16 actions with @elgato/streamdeck, bootstraps the poll
 * manager from saved server configs so polling starts immediately, and
 * installs a shutdown hook to dispose timers cleanly on plugin exit.
 */

import streamDeck from '@elgato/streamdeck';

import { pollManager } from './api/poll-manager.js';
import { listServers } from './utils/settings.js';

import { ServerOverviewAction } from './actions/server-overview.js';
import { ServerStatsAction } from './actions/server-stats.js';
import { NodeOverviewAction } from './actions/node-overview.js';
import { NodeStatsAction } from './actions/node-stats.js';
import { VmOverviewAction } from './actions/vm-overview.js';
import { VmStatsAction } from './actions/vm-stats.js';
import { VmStartAction } from './actions/vm-start.js';
import { VmShutdownAction } from './actions/vm-shutdown.js';
import { VmForceStopAction } from './actions/vm-force-stop.js';
import { VmRebootAction } from './actions/vm-reboot.js';
import { CtOverviewAction } from './actions/ct-overview.js';
import { CtStatsAction } from './actions/ct-stats.js';
import { CtStartAction } from './actions/ct-start.js';
import { CtShutdownAction } from './actions/ct-shutdown.js';
import { CtForceStopAction } from './actions/ct-force-stop.js';
import { CtRebootAction } from './actions/ct-reboot.js';

const TAG = '[Plugin]';

streamDeck.logger.info(`${TAG} Proxmox Manager starting`);

// Register every action with the action service. The service uses each
// action's `manifestId` to route incoming events.
const actions = [
	new ServerOverviewAction(),
	new ServerStatsAction(),
	new NodeOverviewAction(),
	new NodeStatsAction(),
	new VmOverviewAction(),
	new VmStatsAction(),
	new VmStartAction(),
	new VmShutdownAction(),
	new VmForceStopAction(),
	new VmRebootAction(),
	new CtOverviewAction(),
	new CtStatsAction(),
	new CtStartAction(),
	new CtShutdownAction(),
	new CtForceStopAction(),
	new CtRebootAction()
];
for (const action of actions) {
	streamDeck.actions.registerAction(action);
}
streamDeck.logger.info(`${TAG} registered ${actions.length} actions`);

// Connect to Stream Deck. Once connected, bootstrap each configured
// server so that hierarchy caches warm up in the background and the PI
// can populate dropdowns instantly.
streamDeck.connect().then(async () => {
	streamDeck.logger.info(`${TAG} connected to Stream Deck`);
	try {
		const servers = await listServers();
		streamDeck.logger.info(`${TAG} bootstrapping ${servers.length} saved server(s)`);
		for (const server of servers) {
			await pollManager.ensureServer(server.id);
			pollManager.refreshHierarchy(server.id).catch((err) => {
				streamDeck.logger.warn(`${TAG} initial hierarchy refresh for ${server.name} failed: ${err.message}`);
			});
		}
	} catch (err) {
		streamDeck.logger.error(`${TAG} bootstrap failed`, err);
	}
});

// Clean shutdown on SIGINT / SIGTERM.
const shutdown = async (signal) => {
	streamDeck.logger.info(`${TAG} shutdown (${signal})`);
	await pollManager.shutdown();
	process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
