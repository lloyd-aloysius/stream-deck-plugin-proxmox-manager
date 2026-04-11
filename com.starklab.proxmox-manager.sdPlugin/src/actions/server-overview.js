/**
 * Server Overview — folder action showing aggregate server health.
 * Status derived from GET /nodes: all online = online, some down = degraded,
 * all down or fetch error = offline.
 */

import {
	BaseSingletonAction,
	MarqueeDriver,
	attachSubscription,
	connectionOverride,
	safeSetImage
} from './base.js';
import { endpoints } from '../api/poll-manager.js';
import { buildServerOverviewIcon, buildUnconfiguredIcon, buildAuthErrorIcon } from '../icons/status-icons.js';
import { getServer } from '../utils/settings.js';

const TAG = '[ServerOverview]';

export class ServerOverviewAction extends BaseSingletonAction {
	manifestId = 'com.starklab.proxmox-manager.server-overview';

	async onWillAppear(ev) {
		await this.#mount(ev);
	}

	async onWillDisappear(ev) {
		this.#unmount(ev);
	}

	async onDidReceiveSettings(ev) {
		this.#unmount(ev);
		await this.#mount(ev);
	}

	async #mount(ev) {
		const settings = ev.payload?.settings ?? {};
		const serverId = settings.serverId;
		if (!serverId) {
			await safeSetImage(ev.action, buildUnconfiguredIcon('server'));
			return;
		}

		const config = await getServer(serverId);
		const name = config?.name ?? 'Server';

		const entry = {
			dispose: () => {},
			serverId,
			name,
			latest: undefined,
			marquee: undefined
		};
		entry.marquee = new MarqueeDriver((frame) => this.#render(ev.action, entry, frame));
		this.instances.set(ev.action.id, entry);

		entry.dispose = await attachSubscription(serverId, endpoints.nodes(serverId), (result) => {
			entry.latest = result;
			entry.marquee.setLabels([entry.name]);
			this.#render(ev.action, entry, entry.marquee.current());
		});
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
		const { name, latest } = entry;
		if (!latest) return;
		const override = connectionOverride(latest.connection);
		if (override === 'auth') {
			await safeSetImage(action, buildAuthErrorIcon('server'));
			return;
		}
		if (override === 'reconnecting') {
			await safeSetImage(action, buildServerOverviewIcon({ state: 'reconnecting', name, frame }));
			return;
		}
		if (latest.error && !latest.data) {
			await safeSetImage(action, buildServerOverviewIcon({ state: 'offline', name, frame }));
			return;
		}
		const nodes = latest.data ?? [];
		const total = nodes.length;
		const online = nodes.filter((n) => n.status === 'online').length;
		let state = 'offline';
		if (online === total && total > 0) state = 'online';
		else if (online > 0) state = 'degraded';
		await safeSetImage(action, buildServerOverviewIcon({ state, name, frame }));
	}
}

export { TAG as SERVER_OVERVIEW_TAG };
