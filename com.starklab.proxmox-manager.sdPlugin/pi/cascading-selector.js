/*
 * Reusable cascading Server → Node → VM/CT selector.
 *
 * Consumed by every action PI that needs to pick a resource.
 *
 *   const sel = createCascadingSelector({
 *     ctx, root: document.getElementById('cascading'),
 *     levels: ['server', 'node', 'vm']   // or ['server'], ['server', 'node'], ['server', 'node', 'ct']
 *   });
 *   sel.onChange((value) => ctx.saveSettings(value));
 *
 * Values saved to settings: { serverId, node, vmid, label }.
 */

window.createCascadingSelector = function createCascadingSelector({ ctx, root, levels }) {
	root.innerHTML = '';

	const state = {
		servers: [],
		hierarchy: undefined
	};

	const needServer = levels.includes('server');
	const needNode = levels.includes('node');
	const needVm = levels.includes('vm');
	const needCt = levels.includes('ct');

	const { serverRow, serverSelect, manageServersBtn } = buildServerRow(needServer);
	const { nodeRow, nodeSelect, refreshBtn } = buildNodeRow(needNode);
	const { guestRow, guestSelect, guestLabel } = buildGuestRow(needVm || needCt, needVm ? 'VM' : 'Container');

	if (needServer) root.appendChild(serverRow);
	if (needNode) root.appendChild(nodeRow);
	if (needVm || needCt) root.appendChild(guestRow);

	const changeListeners = [];

	function emit() {
		const value = {
			serverId: serverSelect?.value || undefined,
			node: nodeSelect?.value || undefined,
			vmid: guestSelect?.value || undefined,
			label: guestSelect?.selectedOptions?.[0]?.dataset.label || undefined
		};
		for (const fn of changeListeners) fn(value);
	}

	// Populate server list on demand.
	function refreshServers() {
		ctx.sendToPlugin({ type: 'list-servers' });
	}

	function refreshHierarchy() {
		const serverId = serverSelect?.value;
		if (!serverId) return;
		ctx.sendToPlugin({ type: 'refresh-hierarchy', serverId });
	}

	function loadHierarchy() {
		const serverId = serverSelect?.value;
		if (!serverId) return;
		ctx.sendToPlugin({ type: 'get-hierarchy', serverId });
	}

	function populateServers(servers) {
		state.servers = servers;
		if (!serverSelect) return;
		const selected = ctx.settings.serverId ?? serverSelect.value;
		serverSelect.innerHTML = '<option value="">— pick a server —</option>';
		for (const s of servers) {
			const opt = document.createElement('option');
			opt.value = s.id;
			opt.textContent = s.name;
			serverSelect.appendChild(opt);
		}
		if (selected && servers.some((s) => s.id === selected)) {
			serverSelect.value = selected;
			loadHierarchy();
		}
	}

	function populateHierarchy(nodes) {
		state.hierarchy = nodes;
		if (nodeSelect) {
			const selectedNode = ctx.settings.node ?? nodeSelect.value;
			nodeSelect.innerHTML = '<option value="">— pick a node —</option>';
			for (const n of nodes) {
				const opt = document.createElement('option');
				opt.value = n.node;
				opt.textContent = n.node;
				nodeSelect.appendChild(opt);
			}
			if (selectedNode && nodes.some((n) => n.node === selectedNode)) {
				nodeSelect.value = selectedNode;
				populateGuests();
			}
		} else {
			emit();
		}
	}

	function populateGuests() {
		if (!guestSelect) { emit(); return; }
		const selectedVmid = String(ctx.settings.vmid ?? guestSelect.value ?? '');
		const nodeName = nodeSelect?.value;
		const nodeObj = state.hierarchy?.find((n) => n.node === nodeName);
		const guests = nodeObj ? (needVm ? nodeObj.vms : nodeObj.cts) : [];
		guestSelect.innerHTML = `<option value="">— pick a ${needVm ? 'VM' : 'container'} —</option>`;
		for (const g of guests) {
			const opt = document.createElement('option');
			opt.value = String(g.vmid);
			opt.textContent = `${g.vmid} — ${g.name ?? '(no name)'}`;
			opt.dataset.label = g.name ?? '';
			guestSelect.appendChild(opt);
		}
		if (selectedVmid && guests.some((g) => String(g.vmid) === selectedVmid)) {
			guestSelect.value = selectedVmid;
		}
		emit();
	}

	// Wire up events.
	if (serverSelect) {
		serverSelect.addEventListener('change', () => {
			state.hierarchy = undefined;
			if (nodeSelect) nodeSelect.innerHTML = '<option value="">— pick a node —</option>';
			if (guestSelect) guestSelect.innerHTML = '<option value="">—</option>';
			if (serverSelect.value) loadHierarchy();
			emit();
		});
	}
	if (nodeSelect) nodeSelect.addEventListener('change', () => { populateGuests(); emit(); });
	if (guestSelect) guestSelect.addEventListener('change', () => emit());
	if (refreshBtn) refreshBtn.addEventListener('click', refreshHierarchy);
	if (manageServersBtn) manageServersBtn.addEventListener('click', () => window.openServerManager?.());

	// Incoming messages from the plugin.
	ctx.onMessage((msg) => {
		if (msg.type === 'servers') populateServers(msg.servers ?? []);
		else if (msg.type === 'hierarchy') populateHierarchy(msg.nodes ?? []);
	});

	// Initial load.
	refreshServers();

	return {
		onChange(fn) { changeListeners.push(fn); },
		refreshServers,
		refreshHierarchy
	};
};

function buildServerRow() {
	const row = document.createElement('div');
	row.className = 'cascading-group';
	row.innerHTML = `
		<label>Server</label>
		<select class="server-select"></select>
		<button type="button" class="refresh manage-servers">Manage</button>
	`;
	return {
		serverRow: row,
		serverSelect: row.querySelector('.server-select'),
		manageServersBtn: row.querySelector('.manage-servers')
	};
}

function buildNodeRow() {
	const row = document.createElement('div');
	row.className = 'cascading-group';
	row.innerHTML = `
		<label>Node</label>
		<select class="node-select"><option value="">—</option></select>
		<button type="button" class="refresh refresh-hierarchy" title="Refresh cache">↻</button>
	`;
	return {
		nodeRow: row,
		nodeSelect: row.querySelector('.node-select'),
		refreshBtn: row.querySelector('.refresh-hierarchy')
	};
}

function buildGuestRow(enabled, label) {
	const row = document.createElement('div');
	row.className = 'cascading-group';
	row.innerHTML = `
		<label>${label}</label>
		<select class="guest-select"><option value="">—</option></select>
		<span></span>
	`;
	return {
		guestRow: row,
		guestSelect: row.querySelector('.guest-select'),
		guestLabel: label
	};
}
