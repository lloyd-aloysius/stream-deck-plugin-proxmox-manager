/**
 * Node Overview — folder action showing one node's status.
 * API: GET /nodes/{node}/status
 */

import {
	BaseSingletonAction,
	MarqueeDriver,
	attachSubscription,
	connectionOverride,
	safeSetImage
} from './base.js';
import { endpoints } from '../api/poll-manager.js';
import { buildNodeOverviewIcon, buildUnconfiguredIcon, buildAuthErrorIcon } from '../icons/status-icons.js';

const TAG = '[NodeOverview]';

export class NodeOverviewAction extends BaseSingletonAction {
	manifestId = 'com.starklab.proxmox-manager.node-overview';

	async onWillAppear(ev) { await this.#mount(ev); }
	async onWillDisappear(ev) { this.#unmount(ev); }
	async onDidReceiveSettings(ev) { this.#unmount(ev); await this.#mount(ev); }

	async #mount(ev) {
		const { serverId, node } = ev.payload?.settings ?? {};
		if (!serverId || !node) {
			await safeSetImage(ev.action, buildUnconfiguredIcon('node'));
			return;
		}
		const entry = {
			dispose: () => {},
			node,
			latest: undefined,
			marquee: undefined
		};
		entry.marquee = new MarqueeDriver((frame) => this.#render(ev.action, entry, frame));
		this.instances.set(ev.action.id, entry);
		entry.dispose = await attachSubscription(
			serverId,
			endpoints.nodeStatus(serverId, node),
			(result) => {
				entry.latest = result;
				entry.marquee.setLabels([entry.node]);
				this.#render(ev.action, entry, entry.marquee.current());
			}
		);
	}

	#unmount(ev) {
		const entry = this.instances.get(ev.action.id);
		if (entry) {
			entry.marquee?.stop();
			entry.dispose();
			this.instances.delete(ev.action.id);
		}
	}

	async #render(action, entry, frame) {
		const { node, latest } = entry;
		if (!latest) return;
		const override = connectionOverride(latest.connection);
		if (override === 'auth') {
			await safeSetImage(action, buildAuthErrorIcon('node'));
			return;
		}
		if (override === 'reconnecting') {
			await safeSetImage(action, buildNodeOverviewIcon({ state: 'reconnecting', name: node, frame }));
			return;
		}
		if (latest.error && !latest.data) {
			await safeSetImage(action, buildNodeOverviewIcon({ state: 'offline', name: node, frame }));
			return;
		}
		// /nodes/{node}/status doesn't include a status field; reaching it
		// successfully means the node is online.
		await safeSetImage(action, buildNodeOverviewIcon({ state: 'online', name: node, frame }));
	}
}

export { TAG as NODE_OVERVIEW_TAG };
