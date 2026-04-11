import { GuestOverviewAction } from './guest-actions.js';

export class VmOverviewAction extends GuestOverviewAction {
	manifestId = 'com.starklab.proxmox-manager.vm-overview';
	constructor() { super('vm'); }
}
