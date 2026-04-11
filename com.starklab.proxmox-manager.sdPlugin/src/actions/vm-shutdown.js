import { GuestLifecycleAction } from './guest-actions.js';

export class VmShutdownAction extends GuestLifecycleAction {
	constructor() {
		super({
			kind: 'vm',
			actionKind: 'shutdown',
			requireLongPress: true,
			readyStates: ['running', 'paused'],
			topText: 'SHUTDOWN',
			manifestId: 'com.starklab.proxmox-manager.vm-shutdown'
		});
	}
}
