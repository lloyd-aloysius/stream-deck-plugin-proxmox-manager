import { GuestLifecycleAction } from './guest-actions.js';

export class VmForceStopAction extends GuestLifecycleAction {
	constructor() {
		super({
			kind: 'vm',
			actionKind: 'stop',
			requireLongPress: true,
			readyStates: ['running', 'paused'],
			topText: 'FORCE',
			manifestId: 'com.starklab.proxmox-manager.vm-force-stop'
		});
	}
}
