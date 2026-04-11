import { GuestLifecycleAction } from './guest-actions.js';

export class VmRebootAction extends GuestLifecycleAction {
	constructor() {
		super({
			kind: 'vm',
			actionKind: 'reboot',
			requireLongPress: true,
			readyStates: ['running', 'stopped', 'paused'],
			topText: 'REBOOT',
			manifestId: 'com.starklab.proxmox-manager.vm-reboot'
		});
	}
}
