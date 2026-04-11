import { GuestStatsAction } from './guest-actions.js';

export class VmStatsAction extends GuestStatsAction {
	manifestId = 'com.starklab.proxmox-manager.vm-stats';
	constructor() { super('vm'); }
}
