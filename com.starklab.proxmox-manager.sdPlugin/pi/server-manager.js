/*
 * Server management modal — shared across every PI via `window.openServerManager()`.
 *
 * Lists configured servers, lets the user add/edit/delete, and provides
 * a "Test Connection" button that hits the plugin's test helper.
 */

(function () {
	let ctx;
	let modal;
	let form;
	let editing = null;
	let servers = [];

	function buildModal() {
		modal = document.createElement('div');
		modal.id = 'server-manager-modal';
		modal.style.cssText = `
			position: fixed; inset: 0; background: rgba(0,0,0,0.6);
			display: none; align-items: center; justify-content: center;
			z-index: 9999; padding: 16px;
		`;
		modal.innerHTML = `
			<div style="background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 14px; width: 100%; max-width: 360px; max-height: 90vh; overflow-y: auto;">
				<h3 style="margin-top:0">Manage Servers</h3>
				<div id="sm-list" class="server-list"></div>
				<div class="divider"></div>
				<h3 id="sm-form-title">Add Server</h3>
				<form id="sm-form">
					<div class="row"><label>Name</label><input name="name" required /></div>
					<div class="row"><label>Host</label><input name="host" placeholder="host:8006" required /></div>
					<div class="row"><label>Token ID</label><input name="tokenId" placeholder="user@realm!id" required /></div>
					<div class="row"><label>Secret</label><input name="tokenSecret" type="password" required /></div>
					<div class="row"><label>Verify SSL</label><input name="verifySSL" type="checkbox" /></div>
					<div class="row"><label>Status (s)</label><input name="statusPollSeconds" type="number" min="1" value="5" /></div>
					<div class="row"><label>Stats (s)</label><input name="statsPollSeconds" type="number" min="1" value="10" /></div>
					<div class="hint" id="sm-status"></div>
					<div class="actions">
						<button type="button" id="sm-test">Test Connection</button>
						<button type="submit" class="primary">Save</button>
						<button type="button" id="sm-cancel">Cancel</button>
						<button type="button" id="sm-close" style="margin-left:auto">Close</button>
					</div>
				</form>
			</div>
		`;
		document.body.appendChild(modal);
		form = modal.querySelector('#sm-form');
		form.addEventListener('submit', onSubmit);
		modal.querySelector('#sm-test').addEventListener('click', onTest);
		modal.querySelector('#sm-cancel').addEventListener('click', resetForm);
		modal.querySelector('#sm-close').addEventListener('click', closeModal);
	}

	function renderList() {
		const listEl = modal.querySelector('#sm-list');
		listEl.innerHTML = '';
		if (!servers.length) {
			listEl.innerHTML = '<div class="hint" style="padding:6px">No servers configured yet.</div>';
			return;
		}
		for (const s of servers) {
			const item = document.createElement('div');
			item.className = 'server-item';
			item.innerHTML = `
				<div class="name"><strong>${escapeHtml(s.name)}</strong><br><span class="hint">${escapeHtml(s.host)}</span></div>
				<div class="controls">
					<button type="button" data-edit="${s.id}">Edit</button>
					<button type="button" class="danger" data-delete="${s.id}">Delete</button>
				</div>
			`;
			listEl.appendChild(item);
		}
		listEl.querySelectorAll('[data-edit]').forEach((b) =>
			b.addEventListener('click', () => populateForm(servers.find((s) => s.id === b.dataset.edit)))
		);
		listEl.querySelectorAll('[data-delete]').forEach((b) =>
			b.addEventListener('click', () => {
				if (confirm('Delete this server?')) {
					ctx.sendToPlugin({ type: 'delete-server', serverId: b.dataset.delete });
				}
			})
		);
	}

	function populateForm(server) {
		if (!server) return;
		editing = server.id;
		modal.querySelector('#sm-form-title').textContent = 'Edit Server';
		form.elements.name.value = server.name;
		form.elements.host.value = server.host;
		form.elements.tokenId.value = server.tokenId;
		form.elements.tokenSecret.value = ''; // secrets are stripped before sending to PI
		form.elements.tokenSecret.placeholder = '(unchanged)';
		form.elements.verifySSL.checked = Boolean(server.verifySSL);
		form.elements.statusPollSeconds.value = server.statusPollSeconds ?? 5;
		form.elements.statsPollSeconds.value = server.statsPollSeconds ?? 10;
		setStatus('');
	}

	function resetForm() {
		editing = null;
		modal.querySelector('#sm-form-title').textContent = 'Add Server';
		form.reset();
		form.elements.statusPollSeconds.value = 5;
		form.elements.statsPollSeconds.value = 10;
		form.elements.tokenSecret.placeholder = '';
		setStatus('');
	}

	function collectFormConfig() {
		const cfg = {
			name: form.elements.name.value,
			host: form.elements.host.value,
			tokenId: form.elements.tokenId.value,
			tokenSecret: form.elements.tokenSecret.value,
			verifySSL: form.elements.verifySSL.checked,
			statusPollSeconds: Number(form.elements.statusPollSeconds.value),
			statsPollSeconds: Number(form.elements.statsPollSeconds.value)
		};
		if (editing) {
			cfg.id = editing;
			// Keep existing secret if left blank
			const existing = servers.find((s) => s.id === editing);
			if (!cfg.tokenSecret && existing) {
				// Only the plugin-side has the real secret; a blank secret on update means "leave unchanged".
				// We signal this with a sentinel; the plugin will ignore an empty secret.
				delete cfg.tokenSecret;
			}
		}
		return cfg;
	}

	function onSubmit(ev) {
		ev.preventDefault();
		const cfg = collectFormConfig();
		if (!cfg.tokenSecret && !editing) {
			setStatus('Token secret is required.', 'error');
			return;
		}
		// For edits that don't update the secret, fetch original first.
		if (editing && cfg.tokenSecret === undefined) {
			const existing = servers.find((s) => s.id === editing);
			// The PI only has a masked secret ('••••'); we need the plugin to preserve it.
			// Send the update with a flag so the plugin-side can handle it.
			ctx.sendToPlugin({ type: 'save-server', config: { ...cfg, _preserveSecret: true } });
		} else {
			ctx.sendToPlugin({ type: 'save-server', config: cfg });
		}
		setStatus('Saving…');
	}

	function onTest() {
		const cfg = collectFormConfig();
		if (!cfg.tokenSecret) {
			setStatus('Enter the token secret to test.', 'error');
			return;
		}
		setStatus('Testing…');
		ctx.sendToPlugin({ type: 'test-connection', config: cfg });
	}

	function setStatus(text, kind = '') {
		const el = modal.querySelector('#sm-status');
		el.textContent = text;
		el.className = 'hint ' + (kind || '');
	}

	function openModal() {
		if (!modal) buildModal();
		modal.style.display = 'flex';
		ctx.sendToPlugin({ type: 'list-servers' });
	}

	function closeModal() {
		if (modal) modal.style.display = 'none';
		resetForm();
	}

	function escapeHtml(s) {
		return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
	}

	window.installServerManager = function (sdpiCtx) {
		ctx = sdpiCtx;
		ctx.onMessage((msg) => {
			if (!modal) return;
			if (msg.type === 'servers') {
				servers = msg.servers ?? [];
				renderList();
			} else if (msg.type === 'test-result') {
				if (msg.ok) setStatus('Connected — PVE ' + (msg.version ?? ''), 'success');
				else setStatus('Failed: ' + (msg.error?.message ?? 'unknown'), 'error');
			} else if (msg.type === 'save-result') {
				if (msg.ok) {
					setStatus('Saved.', 'success');
					resetForm();
				}
			} else if (msg.type === 'error') {
				setStatus('Error: ' + (msg.error?.message ?? 'unknown'), 'error');
			}
		});
	};

	window.openServerManager = openModal;
})();
