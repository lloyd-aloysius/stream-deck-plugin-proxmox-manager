import { GuestLifecycleAction } from './guest-actions.js';

export class VmStartAction extends GuestLifecycleAction {
	constructor() {
		super({
			kind: 'vm',
			actionKind: 'start',
			requireLongPress: false,
			readyStates: ['stopped'],
			topText: 'START',
			manifestId: 'com.starklab.proxmox-manager.vm-start'
		});
	}
}
