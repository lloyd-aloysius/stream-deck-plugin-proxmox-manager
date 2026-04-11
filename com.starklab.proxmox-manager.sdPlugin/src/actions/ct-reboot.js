import { GuestLifecycleAction } from './guest-actions.js';

export class CtRebootAction extends GuestLifecycleAction {
	constructor() {
		super({
			kind: 'ct',
			actionKind: 'reboot',
			requireLongPress: true,
			readyStates: ['running', 'stopped', 'paused'],
			topText: 'REBOOT',
			manifestId: 'com.starklab.proxmox-manager.ct-reboot'
		});
	}
}
