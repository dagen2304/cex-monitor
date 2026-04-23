/**
 * NOC INFRA Dashboard - Core Logic
 * Handles SSE streams, DOM updates, and UI interactions.
 */

class Dashboard {
    constructor() {
        this.views = {
            vmware: document.getElementById('view-vmware'),
            storage: document.getElementById('view-storage')
        };
        
        this.navLinks = document.querySelectorAll('.nav-link');
        this.refreshBtn = document.getElementById('refresh-trigger');
        
        this.sse = {
            vmware: null,
            storage: null
        };

        this.data = {
            vmware: { 
                total: 0, on: 0, off: 0, suspend: 0, 
                clusters: [], datastores: [], vcenters: [] 
            },
            storage: []
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.startClock();
        this.startVMwareStream();
        this.startStorageStream();
    }

    setupEventListeners() {
        // View Switching
        this.navLinks.forEach(link => {
            link.addEventListener('click', () => {
                const view = link.getAttribute('data-view');
                this.switchView(view);
            });
        });

        // Event Listeners for Search
        document.getElementById('search-vcenters').addEventListener('input', (e) => this.filterVCenters(e.target.value));
        document.getElementById('search-clusters').addEventListener('input', (e) => this.filterTable('clusters-detailed-body', e.target.value));
        document.getElementById('search-datastores').addEventListener('input', (e) => this.filterTable('datastores-body', e.target.value));
        
        // Modal search
        document.getElementById('search-modal-hosts').addEventListener('input', (e) => this.filterTable('modal-hosts-body', e.target.value));
        document.getElementById('search-modal-vms').addEventListener('input', (e) => this.filterTable('modal-vms-body', e.target.value));
        
        // Manual Refresh
        this.refreshBtn.addEventListener('click', () => {
            this.refreshAll();
        });
        
        // Modal logic
        document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
        document.getElementById('modal-overlay').addEventListener('click', (e) => {
            if (e.target.id === 'modal-overlay') this.closeModal();
        });
        
        // Modal Tab switching
        document.querySelectorAll('.modal-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.getAttribute('data-tab');
                this.switchModalTab(target);
            });
        });
    }

    switchView(viewName) {
        // Update Nav
        this.navLinks.forEach(l => l.classList.remove('active'));
        document.querySelector(`[data-view="${viewName}"]`).classList.add('active');

        // Update Views
        Object.keys(this.views).forEach(v => {
            this.views[v].classList.remove('active');
        });
        this.views[viewName].classList.add('active');

        // Update Header
        const titles = {
            vmware: { title: 'VMware vSphere', sub: 'Supervision Multi-vCenter' },
            storage: { title: 'Baies de Stockage', sub: 'Performance & Capacité SAN/NAS' }
        };
        document.getElementById('current-view-title').textContent = titles[viewName].title;
        document.getElementById('current-view-subtitle').textContent = titles[viewName].sub;
    }

    startClock() {
        const update = () => {
            const now = new Date();
            document.getElementById('clock-time').textContent = now.toLocaleTimeString('fr-FR');
            document.getElementById('clock-date').textContent = now.toLocaleDateString('fr-FR', { 
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
            });
        };
        setInterval(update, 1000);
        update();
    }

    refreshAll() {
        this.refreshBtn.classList.add('loading');
        
        // Reset local data counters for a clean UI update
        this.data.vmware = { total: 0, on: 0, off: 0, suspend: 0, clusters: [], datastores: [], vcenters: [] };
        document.getElementById('vcenters-grid').innerHTML = '<div class="empty-state">Rafraîchissement en cours...</div>';
        document.getElementById('clusters-grid').innerHTML = '<div class="empty-state">Attente vCenter...</div>';
        document.getElementById('datastores-body').innerHTML = '';
        document.getElementById('storage-container').innerHTML = '';

        // Restart Streams
        this.startVMwareStream();
        this.startStorageStream();

        setTimeout(() => this.refreshBtn.classList.remove('loading'), 2000);
    }

    // --- STREAMING LOGIC ---

    startVMwareStream() {
        if (this.sse.vmware) this.sse.vmware.close();
        
        this.sse.vmware = new EventSource('/api/vmware/stream');
        
        this.sse.vmware.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleVMwareUpdate(data);
        };

        this.sse.vmware.addEventListener('end', () => {
            console.log('VMware stream ended');
            this.sse.vmware.close();
        });

        this.sse.vmware.onerror = () => {
            console.error('VMware stream error');
            this.sse.vmware.close();
        };
    }

    startStorageStream() {
        if (this.sse.storage) this.sse.storage.close();

        this.sse.storage = new EventSource('/api/storage/stream');

        this.sse.storage.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleStorageUpdate(data);
        };

        this.sse.storage.addEventListener('end', () => {
            console.log('Storage stream ended');
            this.sse.storage.close();
        });
    }

    // --- DATA HANDLERS ---

    handleVMwareUpdate(data) {
        if (data.state === "UP" || data.state === "CONNECTED") {
            // Update Counters
            this.data.vmware.total += data.vms.total;
            this.data.vmware.on += data.vms.on;
            this.data.vmware.off += data.vms.off;
            this.data.vmware.suspend += data.vms.suspend;
            this.updateVMwareCounters();

            // Handle vCenters
            this.renderVCenter(data);
            this.updateBadge('badge-vcenters', document.querySelectorAll('.vc-card').length + ' vCenters');

            // Handle Clusters
            if (data.clusters) {
                data.clusters.forEach(c => {
                    this.renderCluster(c);
                    this.renderDetailedCluster(c, data.vcenter);
                });
                this.updateBadge('badge-clusters', document.querySelectorAll('.cluster-card').length + ' clusters');
                this.updateBadge('badge-clusters-detailed', document.querySelectorAll('#clusters-detailed-body tr').length + ' clusters');
            }

            // Handle Datastores
            if (data.datastores) {
                data.datastores.forEach(ds => this.renderDatastore(ds));
                this.updateBadge('badge-datastores', document.querySelectorAll('#datastores-body tr').length + ' datastores');
            }
        } else {
            this.renderVCenter(data); // Render even if DOWN to show error
            this.showNotification(`Erreur vCenter: ${data.vcenter} (${data.error || 'Indisponible'})`, 'error');
        }
    }

    handleStorageUpdate(data) {
        const container = document.getElementById('storage-container');
        if (container.querySelector('.empty-state')) container.innerHTML = '';

        const card = document.createElement('div');
        card.className = 'array-card';
        
        let usagePct = 0;
        if (data.capacity && data.capacity.total_gb > 0) {
            if (data.capacity.used_pct !== undefined && data.capacity.used_pct !== null) {
                usagePct = data.capacity.used_pct;
            } else {
                const used = data.capacity.used_gb || 0;
                const total = data.capacity.total_gb;
                usagePct = ((used / total) * 100).toFixed(1);
            }
        }
        if (isNaN(usagePct)) usagePct = 0;
        const statusClass = usagePct > 90 ? 'red' : (usagePct > 75 ? 'yellow' : 'green');

        card.innerHTML = `
            <div class="array-header">
                <div>
                    <span class="array-type">${data.type || 'Storage'}</span>
                    <h4 style="margin-top:8px; font-size:1.2rem;">${data.name}</h4>
                    <p style="font-size:0.8rem; color:var(--text-muted);">${data.ip}</p>
                </div>
                <div class="status-dot ${data.state === 'DOWN' ? 'red' : 'green'}"></div>
            </div>
            ${data.state === 'DOWN' ? `
                <div style="color:var(--danger); font-size:0.85rem; padding:10px; background:rgba(239,68,68,0.1); border-radius:8px;">
                    ${data.error_msg || 'Connexion échouée'}
                </div>
            ` : `
                <div class="resource-row">
                    <div class="resource-label">
                        <span>Capacité Utilisée</span>
                        <span>${usagePct}%</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" style="width: ${usagePct}%; background: ${this.getStatusColor(usagePct)}"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:0.7rem; margin-top:5px; color:var(--text-muted);">
                        <span>${this.formatBytes(data.capacity.used_gb || 0)} utilisé</span>
                        <span>Total: ${this.formatBytes(data.capacity.total_gb || 0)}</span>
                    </div>
                </div>
            `}
        `;
        container.appendChild(card);
    }

    // --- RENDERING HELPERS ---

    updateVMwareCounters() {
        document.getElementById('count-total').textContent = this.data.vmware.total;
        document.getElementById('count-on').textContent = this.data.vmware.on;
        document.getElementById('count-off').textContent = this.data.vmware.off;
        document.getElementById('count-suspend').textContent = this.data.vmware.suspend;
    }

    renderCluster(c) {
        const grid = document.getElementById('clusters-grid');
        if (grid.querySelector('.empty-state')) grid.innerHTML = '';

        const card = document.createElement('div');
        card.className = 'cluster-card';
        card.innerHTML = `
            <div class="cluster-card-header">
                <div>
                    <span class="cluster-name">${c.name}</span>
                    <span class="cluster-vc">${c.vcenter_name}</span>
                </div>
                <div class="status-dot ${c.status === 'red' ? 'red' : (c.status === 'yellow' ? 'yellow' : 'green')}"></div>
            </div>
            <div class="cluster-mini-stats">
                <div class="mini-stat">
                    <span class="val">${c.total_hosts}</span>
                    <span class="lbl">Hôtes</span>
                </div>
                <div class="mini-stat">
                    <span class="val">${c.total_vms}</span>
                    <span class="lbl">VMs</span>
                </div>
            </div>
            <div class="resource-row">
                <div class="resource-label"><span>CPU</span><span>${c.cpu_usage_pct}%</span></div>
                <div class="progress-track"><div class="progress-fill fill-cpu" style="width: ${c.cpu_usage_pct}%"></div></div>
            </div>
            <div class="resource-row">
                <div class="resource-label"><span>RAM</span><span>${c.mem_usage_pct}%</span></div>
                <div class="progress-track"><div class="progress-fill fill-ram" style="width: ${c.mem_usage_pct}%"></div></div>
            </div>
        `;
        grid.appendChild(card);
    }

    renderDatastore(ds) {
        const body = document.getElementById('datastores-body');
        const usage = ds.usage_pct;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong style="color:var(--text-main)">${ds.name}</strong></td>
            <td><span style="color:var(--primary); font-size:0.8rem;">${ds.vcenter_name}</span></td>
            <td class="font-mono">${this.formatBytes(ds.capacity_gb)}</td>
            <td>
                <div class="progress-track" style="width:100px; display:inline-block; vertical-align:middle; margin-right:10px;">
                    <div class="progress-fill" style="width: ${usage}%; background: ${this.getStatusColor(usage)}"></div>
                </div>
                <span class="font-mono">${usage}%</span>
            </td>
            <td class="font-mono">${this.formatBytes(ds.free_gb)}</td>
            <td><span class="badge" style="background:${this.getStatusColor(usage)}15; color:${this.getStatusColor(usage)}">${usage > 90 ? 'CRITIQUE' : (usage > 75 ? 'ALERTE' : 'OK')}</span></td>
        `;
        body.appendChild(row);
    }

    // --- UTILS ---

    updateBadge(id, text) {
        document.getElementById(id).textContent = text;
    }

    getStatusColor(pct) {
        if (pct > 90) return 'var(--danger)';
        if (pct > 75) return 'var(--warning)';
        return 'var(--success)';
    }

    formatBytes(gb) {
        if (gb >= 1024) return (gb / 1024).toFixed(2) + ' TB';
        return Math.round(gb) + ' GB';
    }

    renderVCenter(vc) {
        const grid = document.getElementById('vcenters-grid');
        if (grid.querySelector('.empty-state')) grid.innerHTML = '';
        
        const cardId = `vc-${vc.vcenter.replace(/\s+/g, '-')}`;
        let card = document.getElementById(cardId);
        if (!card) {
            card = document.createElement('div');
            card.id = cardId;
            card.className = 'vc-card';
            grid.appendChild(card);
        }

        const hostCount = vc.host_list ? vc.host_list.length : 0;
        const hostMaint = vc.host_list ? vc.host_list.filter(h => h.in_maintenance).length : 0;
        const hostActive = hostCount - hostMaint;
        
        const vmOn = vc.vms ? vc.vms.on : 0;
        const vmOff = vc.vms ? vc.vms.off : 0;

        card.innerHTML = `
            <div class="vc-card-glow"></div>
            <div class="vc-card-header">
                <div class="vc-title-group">
                    <span class="vc-name">${vc.vcenter}</span>
                    <span class="vc-ip">${vc.ip}</span>
                </div>
                <div class="status-indicator">
                    <span class="status-text ${vc.state === 'UP' ? 'green' : 'red'}">${vc.state}</span>
                    <div class="pulse-dot ${vc.state === 'UP' ? 'green' : 'red'}"></div>
                </div>
            </div>
            <div class="vc-stats-grid">
                <div class="vc-stat-item">
                    <div class="vc-stat-main">
                        <span class="vc-stat-val">${hostActive}</span>
                        <span class="vc-stat-sep">/</span>
                        <span class="vc-stat-sub ${hostMaint > 0 ? 'text-warning' : ''}">${hostMaint}</span>
                    </div>
                    <span class="vc-stat-lbl">Hôtes ESXi</span>
                </div>
                <div class="vc-stat-item">
                    <div class="vc-stat-main">
                        <span class="vc-stat-val">${vmOn}</span>
                        <span class="vc-stat-sep">/</span>
                        <span class="vc-stat-sub text-muted">${vmOff}</span>
                    </div>
                    <span class="vc-stat-lbl">Machines Virtuelles</span>
                </div>
            </div>
            <div class="vc-card-footer">
                <span class="vc-action">Cliquer pour les détails</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
            </div>
        `;

        card.onclick = () => this.openModal(vc);
    }

    filterVCenters(query) {
        const cards = document.querySelectorAll('.vc-card');
        const q = query.toLowerCase();
        cards.forEach(card => {
            card.style.display = card.innerText.toLowerCase().includes(q) ? '' : 'none';
        });
    }

    openModal(vc) {
        const modal = document.getElementById('modal-overlay');
        document.getElementById('modal-title').textContent = vc.vcenter;
        document.getElementById('modal-subtitle').textContent = vc.ip;
        
        // Populate Hosts
        const hostsBody = document.getElementById('modal-hosts-body');
        hostsBody.innerHTML = '';
        if (vc.host_list) {
            vc.host_list.forEach(h => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong>${h.name}</strong></td>
                    <td>${h.cluster_name}</td>
                    <td>${h.cpu_ghz} GHz</td>
                    <td>${h.num_vms}</td>
                    <td><span class="badge ${h.state === 'connected' ? (h.in_maintenance ? 'yellow' : 'green') : 'red'}">
                        ${h.state === 'connected' ? (h.in_maintenance ? 'MAINTENANCE' : 'OK') : 'ALERTE'}
                    </span></td>
                `;
                hostsBody.append(row);
            });
            document.getElementById('modal-host-count').textContent = vc.host_list.length;
        }

        // Populate VMs
        const vmsBody = document.getElementById('modal-vms-body');
        vmsBody.innerHTML = '';
        if (vc.vm_list) {
            vc.vm_list.slice(0, 500).forEach(vm => { // Limit for performance
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${vm.name}</td>
                    <td><span class="status-dot ${vm.state === 'ON' ? 'green' : 'red'}"></span> ${vm.state}</td>
                `;
                vmsBody.append(row);
            });
            document.getElementById('modal-vm-count').textContent = vc.vm_list.length;
        }

        // Alerts (Example: filtering hosts in error)
        const alertsList = document.getElementById('modal-alerts-list');
        alertsList.innerHTML = '';
        const criticalHosts = (vc.host_list || []).filter(h => h.state !== 'connected' || h.overall_status === 'red');
        if (criticalHosts.length > 0) {
            criticalHosts.forEach(h => {
                const item = document.createElement('div');
                item.className = 'alert-item';
                item.innerHTML = `<strong>${h.name}</strong> est hors-ligne ou présente une alerte matérielle critique.`;
                alertsList.appendChild(item);
            });
        } else {
            alertsList.innerHTML = '<p class="empty-state">Aucune alerte critique détectée.</p>';
        }
        document.getElementById('modal-alert-count').textContent = criticalHosts.length;

        modal.classList.add('active');
        this.switchModalTab('hosts');
    }

    closeModal() {
        document.getElementById('modal-overlay').classList.remove('active');
    }

    switchModalTab(tabId) {
        document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
        document.getElementById(`tab-${tabId}`).classList.add('active');
    }

    renderDetailedCluster(c, vcenterName) {
        const body = document.getElementById('clusters-detailed-body');
        if (body.querySelector('.text-center')) body.innerHTML = '';
        
        const rowId = `row-cluster-${vcenterName}-${c.name}`.replace(/\s+/g, '-');
        let row = document.getElementById(rowId);
        if (!row) {
            row = document.createElement('tr');
            row.id = rowId;
            body.appendChild(row);
        }

        const hostsTotal = c.total_hosts || 0;
        const hostsMaint = c.maint_hosts || 0;
        const totalVMs = c.total_vms || 0;
        const storageUsage = c.storage_usage_pct || 0;
        const drsStatus = c.drs_enabled ? '<span class="badge green">ON</span>' : '<span class="badge">OFF</span>';
        
        row.innerHTML = `
            <td><span class="vc-tag">${vcenterName}</span></td>
            <td><strong>${c.name}</strong></td>
            <td>${hostsTotal} / <span class="${hostsMaint > 0 ? 'text-warning' : ''}">${hostsMaint}</span></td>
            <td>${totalVMs}</td>
            <td>${drsStatus}</td>
            <td>
                <div class="progress-track" style="width: 80px; display: inline-block; vertical-align: middle; margin-right: 8px;">
                    <div class="progress-fill ${storageUsage > 90 ? 'bg-danger' : 'fill-cpu'}" style="width: ${storageUsage}%"></div>
                </div>
                <span class="text-xs">${storageUsage}%</span>
            </td>
            <td>
                <span class="badge ${c.status === 'red' ? 'danger' : (c.status === 'yellow' ? 'warning' : 'success')}">
                    ${c.status === 'red' ? 'CRITIQUE' : (c.status === 'yellow' ? 'ATTENTION' : 'OK')}
                </span>
            </td>
        `;
    }

    filterTable(bodyId, query) {
        const rows = document.querySelectorAll(`#${bodyId} tr`);
        const q = query.toLowerCase();
        rows.forEach(row => {
            row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none';
        });
    }

    sortTable(tableId, colIndex) {
        const table = document.getElementById(tableId);
        const tbody = table.querySelector('tbody');
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const isAsc = table.dataset.sortCol === colIndex.toString() && table.dataset.sortOrder === 'asc';
        
        rows.sort((a, b) => {
            const aVal = a.cells[colIndex].innerText.toLowerCase();
            const bVal = b.cells[colIndex].innerText.toLowerCase();
            return isAsc ? bVal.localeCompare(aVal, undefined, {numeric: true}) : aVal.localeCompare(bVal, undefined, {numeric: true});
        });
        
        table.dataset.sortOrder = isAsc ? 'desc' : 'asc';
        table.dataset.sortCol = colIndex;
        
        rows.forEach(row => tbody.appendChild(row));
    }

    exportModalData(tab, format) {
        const vcName = document.getElementById('modal-title').textContent;
        const filename = `NOC_vCenter_${vcName}_${tab}_${new Date().toISOString().slice(0,10)}`;
        let dataToExport = [];
        
        if (tab === 'hosts') {
            dataToExport.push(['Hôte', 'Cluster', 'CPU', 'VMs', 'Status']);
            const rows = document.querySelectorAll('#modal-hosts-body tr');
            rows.forEach(row => {
                if (row.style.display !== 'none') {
                    dataToExport.push(Array.from(row.cells).map(cell => cell.innerText));
                }
            });
        } else if (tab === 'vms') {
            dataToExport.push(['Nom', 'État']);
            const rows = document.querySelectorAll('#modal-vms-body tr');
            rows.forEach(row => {
                if (row.style.display !== 'none') {
                    dataToExport.push(Array.from(row.cells).map(cell => cell.innerText));
                }
            });
        }

        if (format === 'csv') {
            const csvContent = dataToExport.map(e => e.join(",")).join("\n");
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.setAttribute('download', `${filename}.csv`);
            link.click();
        } else if (format === 'xls') {
            const ws = XLSX.utils.aoa_to_sheet(dataToExport);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Data");
            XLSX.writeFile(wb, `${filename}.xlsx`);
        }
    }

    async exportData(type, format) {
        const filename = `NOC_Export_${type}_${new Date().toISOString().slice(0,10)}`;

        if (format === 'png') {
            const element = type === 'vcenters' ? document.getElementById('vcenters-grid') : (type === 'clusters-detailed' ? document.getElementById('container-clusters-detailed') : document.getElementById('view-vmware'));
            this.showNotification('Génération de la capture...');
            const canvas = await html2canvas(element, { backgroundColor: '#050508' });
            const link = document.createElement('a');
            link.download = `${filename}.png`;
            link.href = canvas.toDataURL();
            link.click();
            return;
        }

        let dataToExport = [];
        if (type === 'vcenters') {
            dataToExport.push(['vCenter', 'IP', 'État', 'Hôtes Actifs', 'Hôtes Maint', 'VMs ON', 'VMs OFF']);
            const cards = document.querySelectorAll('.vc-card');
            cards.forEach(card => {
                if (card.style.display !== 'none') {
                    const name = card.querySelector('.vc-name').innerText;
                    const ip = card.querySelector('.vc-ip').innerText;
                    const state = card.querySelector('.status-text').innerText;
                    const stats = card.querySelectorAll('.vc-stat-val, .vc-stat-sub');
                    dataToExport.push([name, ip, state, stats[0].innerText, stats[1].innerText, stats[2].innerText, stats[3].innerText]);
                }
            });
        } else if (type === 'clusters-detailed') {
            const table = document.getElementById('table-clusters-detailed');
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                if (row.style.display !== 'none') {
                    const rowData = Array.from(row.cells).map(cell => cell.innerText);
                    dataToExport.push(rowData);
                }
            });
        } else {
            // Datastores
            dataToExport.push(['Nom', 'vCenter', 'Capacité', 'Utilisation', 'Libre', 'Status']);
            const rows = document.querySelectorAll('#datastores-body tr');
            rows.forEach(row => {
                if (row.style.display !== 'none') {
                    dataToExport.push(Array.from(row.cells).map(cell => cell.innerText));
                }
            });
        }

        if (format === 'csv') {
            const csvContent = dataToExport.map(e => e.join(",")).join("\n");
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.setAttribute('download', `${filename}.csv`);
            link.click();
        } else if (format === 'xls') {
            const ws = XLSX.utils.aoa_to_sheet(dataToExport);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Data");
            XLSX.writeFile(wb, `${filename}.xlsx`);
        }
    }

    showNotification(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = msg;
        const container = document.getElementById('toast-container');
        if (container) {
            container.appendChild(toast);
            setTimeout(() => toast.remove(), 5000);
        }
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new Dashboard();
});
