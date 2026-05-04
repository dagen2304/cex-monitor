/**
 * NOC INFRA Dashboard - Core Logic
 * Handles SSE streams, DOM updates, and UI interactions.
 */

class Dashboard {
    constructor() {
        this.views = {
            vmware: document.getElementById('view-vmware'),
            storage: document.getElementById('view-storage'),
            capacity: document.getElementById('view-capacity'),
            alerts: document.getElementById('view-alerts'),
            diagnostics: document.getElementById('view-diagnostics')
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
            storage: [],
            globalAlerts: [],
            history: {} // Store [timestamp, cpu, ram] per VC
        };

        this.vcenterFilters = new Set();
        this.currentView = 'vmware';
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.startClock();
        this.startVMwareStream();
        this.startStorageStream();
        this.setupGlobalShortcuts();
    }

    setupEventListeners() {
        // View Switching
        this.navLinks.forEach(link => {
            link.addEventListener('click', () => {
                const view = link.getAttribute('data-view');
                this.switchView(view);
            });
        });

        // VMware Internal Tabs
        document.querySelectorAll('.view-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.getAttribute('data-tab');
                this.switchInternalTab(tab, target);
            });
        });

        // Global Search
        const globalSearch = document.getElementById('global-search');
        globalSearch.addEventListener('input', (e) => this.handleGlobalSearch(e.target.value));

        // Alerts Filtering
        document.getElementById('filter-alerts-severity').addEventListener('change', () => this.renderGlobalAlerts());
        document.getElementById('search-alerts').addEventListener('input', () => this.renderGlobalAlerts());

        // VMware Filters (Inside Tabs)
        document.getElementById('search-clusters').addEventListener('input', (e) => this.filterTable('clusters-detailed-body', e.target.value));
        document.getElementById('search-datastores').addEventListener('input', (e) => this.filterTable('datastores-body', e.target.value));
        
        // Modal search
        document.getElementById('search-modal-hosts').addEventListener('input', (e) => this.filterTable('modal-hosts-body', e.target.value));
        document.getElementById('search-modal-vms').addEventListener('input', (e) => this.filterTable('modal-vms-body', e.target.value));
        
        // Storage Search
        document.getElementById('search-storage').addEventListener('input', (e) => this.filterTable('storage-detailed-body', e.target.value));

        // vCenter Filter
        const vcFilter = document.getElementById('filter-clusters-vc');
        if (vcFilter) {
            vcFilter.addEventListener('change', (e) => this.filterClustersByVC(e.target.value));
        }
        
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

    setupGlobalShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
                e.preventDefault();
                document.getElementById('global-search').focus();
            }
        });
    }

    switchInternalTab(tabElement, targetId) {
        // Update Buttons
        const parent = tabElement.parentElement;
        parent.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
        tabElement.classList.add('active');

        // Update Contents
        const container = parent.parentElement;
        container.querySelectorAll('.view-tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`tab-${targetId}`).classList.add('active');
    }

    handleGlobalSearch(query) {
        const q = query.toLowerCase();
        if (!q) {
            this.resetAllFilters();
            return;
        }

        // Search vCenters
        this.filterVCenters(q);
        
        // Search Clusters
        this.filterTable('clusters-detailed-body', q);
        this.filterClustersCards(q);
        
        // Search Storage
        this.filterTable('storage-detailed-body', q);
        this.filterStorageCards(q);

        // Search Datastores
        this.filterTable('datastores-body', q);
    }

    filterClustersCards(q) {
        const cards = document.querySelectorAll('.cluster-card');
        cards.forEach(card => card.style.display = card.innerText.toLowerCase().includes(q) ? '' : 'none');
    }

    filterStorageCards(q) {
        const cards = document.querySelectorAll('.array-card');
        cards.forEach(card => card.style.display = card.innerText.toLowerCase().includes(q) ? '' : 'none');
    }

    resetAllFilters() {
        document.querySelectorAll('.vc-card, .cluster-card, .array-card, tr').forEach(el => el.style.display = '');
    }

    switchView(viewName) {
        // Update Nav
        this.navLinks.forEach(l => l.classList.remove('active'));
        const activeLink = document.querySelector(`[data-view="${viewName}"]`);
        if (activeLink) activeLink.classList.add('active');

        // Update Views
        Object.keys(this.views).forEach(v => {
            if (this.views[v]) this.views[v].classList.remove('active');
        });
        if (this.views[viewName]) this.views[viewName].classList.add('active');

        // Update Header
        const titles = {
            vmware: { title: 'VMware vSphere', sub: 'Supervision Multi-vCenter' },
            storage: { title: 'Baies de Stockage', sub: 'Performance & Capacité SAN/NAS' },
            capacity: { title: 'Capacité & Tendances', sub: 'Analyse Week-to-Week et Month-on-Month' },
            alerts: { title: 'Alertes Globales', sub: 'Synthèse des incidents critiques' },
            diagnostics: { title: 'Diagnostics API', sub: 'État du cache et du monitoring' }
        };
        
        if (titles[viewName]) {
            document.getElementById('current-view-title').textContent = titles[viewName].title;
            document.getElementById('current-view-subtitle').textContent = titles[viewName].sub;
        }

        if (viewName === 'diagnostics') this.fetchDiagnostics();
        if (viewName === 'alerts') this.renderGlobalAlerts();
        if (viewName === 'capacity') this.fetchCapacityReport();
        
        this.currentView = viewName;
    }

    async fetchCapacityReport() {
        const body = document.getElementById('capacity-report-body');
        body.innerHTML = '<tr><td colspan="6" class="text-center">Calcul des tendances...</td></tr>';
        
        try {
            const resp = await fetch('/api/capacity/report');
            const data = await resp.json();
            
            if (data.length === 0) {
                body.innerHTML = '<tr><td colspan="6" class="text-center">Aucun historique disponible pour le moment.</td></tr>';
                return;
            }

            body.innerHTML = '';
            let totalW2W = 0, countW2W = 0;
            let totalMoM = 0, countMoM = 0;

            data.forEach(item => {
                const row = document.createElement('tr');
                const w2wClass = item.w2w_delta > 0 ? 'text-danger' : (item.w2w_delta < 0 ? 'text-success' : '');
                const momClass = item.mom_delta > 0 ? 'text-danger' : (item.mom_delta < 0 ? 'text-success' : '');
                
                const w2wVal = item.w2w_delta !== null ? (item.w2w_delta > 0 ? '+' : '') + item.w2w_delta + '%' : '--';
                const momVal = item.mom_delta !== null ? (item.mom_delta > 0 ? '+' : '') + item.mom_delta + '%' : '--';
                
                if (item.w2w_delta !== null) { totalW2W += item.w2w_delta; countW2W++; }
                if (item.mom_delta !== null) { totalMoM += item.mom_delta; countMoM++; }

                row.innerHTML = `
                    <td><strong>${item.device_name}</strong> <span class="text-xs text-muted">(${item.device_type})</span></td>
                    <td><code class="text-xs">${item.metric}</code></td>
                    <td class="text-center font-mono">${item.current}%</td>
                    <td class="text-center font-mono ${w2wClass}">${w2wVal}</td>
                    <td class="text-center font-mono ${momClass}">${momVal}</td>
                    <td>
                        ${item.w2w_delta > 2 ? '<span class="badge danger">SATURE</span>' : 
                          (item.w2w_delta > 0 ? '<span class="badge warning">AUGMENTE</span>' : '<span class="badge success">STABLE</span>')}
                    </td>
                `;
                body.appendChild(row);
            });

            // Update Summaries
            document.getElementById('capacity-summary-w2w').textContent = countW2W > 0 ? (Math.round(totalW2W/countW2W*10)/10) + '%' : '--';
            document.getElementById('capacity-summary-mom').textContent = countMoM > 0 ? (Math.round(totalMoM/countMoM*10)/10) + '%' : '--';
            document.getElementById('capacity-last-run').textContent = new Date().toLocaleTimeString();

        } catch (e) {
            body.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Erreur: ${e.message}</td></tr>`;
        }
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
            this.updateSidebarStats();

            // Handle Global Alerts from vCenter
            if (data.error) {
                this.addGlobalAlert(data.vcenter, 'CRITICAL', data.error, 'System', `CONN_ERR_${data.ip || data.vcenter}`);
            }
            
            // Host connection alerts
            if (data.host_list) {
                data.host_list.forEach(h => {
                    if (h.state !== 'connected') {
                        this.addGlobalAlert(data.vcenter, 'CRITICAL', `Hôte ESXi déconnecté: ${h.name}`, 'Host', `HOST_DOWN_${h.name}`);
                    }
                });
            }

            if (data.alerts && data.alerts.length > 0) {
                data.alerts.forEach(a => {
                    this.addGlobalAlert(data.vcenter, a.severity, a.message, a.component, a.id, a.timestamp);
                });
            }

            // Handle vCenters
            this.renderVCenter(data);
            this.updateBadge('badge-vcenters', document.querySelectorAll('.vc-card').length + ' vCenters');

            // Update vCenter Filter Dropdown
            if (data.vcenter && !this.vcenterFilters.has(data.vcenter)) {
                this.vcenterFilters.add(data.vcenter);
                this.updateVCFilterDropdown();
            }

            // Handle Clusters
            if (data.clusters) {
                data.clusters.forEach(c => {
                    const clusterWithVC = { ...c, vcenter_name: data.vcenter };
                    this.renderCluster(clusterWithVC);
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
        if (data.status === "error") {
            this.showNotification(`Erreur ${data.name}: ${data.error}`, 'danger');
            return;
        }

        this.renderArrayCard(data);
        this.renderDetailedStorage(data);
        this.renderHeatmapSquare(data);

        // Handle Global Alerts from Storage
        if (data.state === 'DOWN' || data.error) {
            const sev = (data.state === 'DOWN') ? 'CRITICAL' : 'WARNING';
            this.addGlobalAlert(data.name, sev, data.error || 'Baie injoignable', 'Storage', `CONN_ERR_${data.ip || data.name}`);
        }
        
        if (data.alerts && data.alerts.length > 0) {
            data.alerts.forEach(a => {
                if (a.severity === 'CRITICAL' || a.severity === 'ERROR' || a.severity === 'MAJOR' || a.severity === 'WARNING') {
                    this.addGlobalAlert(data.name, a.severity, a.message, a.component, a.id, a.timestamp);
                }
            });
        }
        
        const count = document.querySelectorAll('.array-card').length;
        this.updateBadge('badge-storage-detailed', count + ' équipements');
    }

    // --- RENDERING HELPERS ---

    updateVMwareCounters() {
        document.getElementById('count-total').textContent = this.data.vmware.total;
        document.getElementById('count-on').textContent = this.data.vmware.on;
        document.getElementById('count-off').textContent = this.data.vmware.off;
        document.getElementById('count-suspend').textContent = this.data.vmware.suspend;
    }

    updateVCFilterDropdown() {
        const select = document.getElementById('filter-clusters-vc');
        if (!select) return;
        
        // Keep "All" option
        select.innerHTML = '<option value="all">Tous les vCenters</option>';
        Array.from(this.vcenterFilters).sort().forEach(vc => {
            const opt = document.createElement('option');
            opt.value = vc;
            opt.textContent = vc;
            select.appendChild(opt);
        });
    }

    filterClustersByVC(vcName) {
        const cards = document.querySelectorAll('.cluster-card');
        cards.forEach(card => {
            if (vcName === 'all' || card.dataset.vcenter === vcName) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });
    }

    renderCluster(c) {
        const grid = document.getElementById('clusters-grid');
        if (grid.querySelector('.empty-state')) grid.innerHTML = '';

        const cardId = `cluster-${c.vcenter_name}-${c.name}`.replace(/\s+/g, '-');
        let card = document.getElementById(cardId);
        if (!card) {
            card = document.createElement('div');
            card.id = cardId;
            card.className = 'cluster-card';
            grid.appendChild(card);
        }
        
        card.dataset.vcenter = c.vcenter_name;
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

    renderArrayCard(data) {
        const container = document.getElementById('storage-container');
        if (container.querySelector('.empty-state')) container.innerHTML = '';

        const cardId = `storage-card-${data.name}`.replace(/\s+/g, '-');
        let card = document.getElementById(cardId);
        if (!card) {
            card = document.createElement('div');
            card.id = cardId;
            card.className = 'array-card';
            container.appendChild(card);
        }
        
        const usagePct = data.capacity ? data.capacity.used_pct : 0;
        const statusClass = data.state === 'DOWN' ? 'red' : (usagePct > 90 ? 'red' : (usagePct > 75 ? 'yellow' : 'green'));

        card.innerHTML = `
            <div class="array-header">
                <div>
                    <span class="array-type">${data.name.split('-')[0] || 'Storage'}</span>
                    <h4 style="margin-top:8px; font-size:1.2rem;">${data.name}</h4>
                    <p style="font-size:0.8rem; color:var(--text-muted);">${data.ip}</p>
                </div>
                <div class="status-dot ${statusClass}"></div>
            </div>
            ${data.state === 'DOWN' ? `
                <div style="color:var(--danger); font-size:0.85rem; padding:10px; background:rgba(239,68,68,0.1); border-radius:8px;">
                    Indisponible: ${data.error || 'Connexion échouée'}
                </div>
            ` : `
                <div class="storage-pools-container" style="display:flex; flex-direction:column; gap:20px;">
                    <!-- Main Aggregate (Optional, but useful as a summary) -->
                    <div class="resource-row summary-row" style="background: rgba(255,255,255,0.02); padding: 12px; border-radius: 8px; border: 1px dashed rgba(255,255,255,0.1);">
                        <div class="resource-label">
                            <span style="font-weight:800; color:#fff;">CAPACITÉ GLOBALE</span>
                            <span style="font-weight:800; color:var(--primary);">${usagePct}%</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill" style="width: ${usagePct}%; background: ${this.getStatusColor(usagePct)}"></div>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:0.7rem; margin-top:5px; color:var(--text-muted);">
                            <span>${this.formatBytes(data.capacity ? data.capacity.used_gb : 0)} utilisé</span>
                            <span>Total: ${this.formatBytes(data.capacity ? data.capacity.total_gb : 0)}</span>
                        </div>
                    </div>

                    <!-- Individual Pools -->
                    <div class="pools-list" style="display:flex; flex-direction:column; gap:12px; padding-left: 10px; border-left: 2px solid rgba(255,255,255,0.05);">
                        ${(data.pools || []).map(pool => `
                            <div class="pool-item">
                                <div class="resource-label" style="font-size: 0.7rem; margin-bottom: 4px;">
                                    <span style="color:var(--text-muted);">${pool.name}</span>
                                    <span>${pool.used_pct}%</span>
                                </div>
                                <div class="progress-track" style="height: 6px;">
                                    <div class="progress-fill" style="width: ${pool.used_pct}%; background: ${this.getStatusColor(pool.used_pct)}; opacity: 0.8;"></div>
                                </div>
                                <div style="display:flex; justify-content:space-between; font-size:0.6rem; color:var(--text-dim); margin-top:2px;">
                                    <span>${pool.used_tb} TB</span>
                                    <span>${pool.total_tb} TB</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `}
        `;
    }

    renderDetailedStorage(data) {
        const body = document.getElementById('storage-detailed-body');
        if (body.querySelector('.text-center')) body.innerHTML = '';
        
        const rowId = `row-storage-${data.name}`.replace(/\s+/g, '-');
        let row = document.getElementById(rowId);
        if (!row) {
            row = document.createElement('tr');
            row.id = rowId;
            body.appendChild(row);
        }

        const usagePct = data.capacity ? data.capacity.used_pct : 0;
        const status = data.overall_status || (data.state === 'DOWN' ? 'Critical' : 'Gray');
        
        // Performance data
        const perf = data.performance || { iops_total: 0, bandwidth_mbps: 0, latency_ms: 0 };
        const iops = perf.iops_total || (perf.iops_read + perf.iops_write) || 0;
        const bw = perf.bandwidth_mbps || 0;
        const lat = perf.latency_ms || perf.latency_ms_read || 0;

        // Derive attributes
        const type = data.name.split('-')[0] || 'Unknown';
        const alarms = (status === 'Red' || status === 'Critical') ? '1 Critique' : (status === 'Yellow' ? '1 Attention' : 'Aucune');
        const diskHealth = (status === 'Red' || status === 'Critical') ? 'Erreur physique' : 'Optimal';
        
        let action = 'RAS';
        if (status === 'Red' || status === 'Critical') action = 'Vérifier disques / Remplacer';
        else if (status === 'Yellow') action = 'Surveiller les logs';
        else if (usagePct > 85) action = 'Prévoir extension capacité';

        row.innerHTML = `
            <td><span class="vc-tag" style="background:rgba(255,255,255,0.1); color:#fff;">${type}</span></td>
            <td><strong>${data.name}</strong></td>
            <td class="font-mono">${iops.toLocaleString()}</td>
            <td class="font-mono">${bw.toFixed(1)}</td>
            <td class="font-mono">${lat.toFixed(2)}</td>
            <td>
                <div class="progress-track" style="width: 80px; display: inline-block; vertical-align: middle; margin-right: 8px;">
                    <div class="progress-fill ${usagePct > 90 ? 'bg-danger' : 'fill-ram'}" style="width: ${usagePct}%"></div>
                </div>
                <span class="text-xs">${usagePct}%</span>
            </td>
            <td><span class="status-text ${status.toLowerCase()}">${diskHealth}</span></td>
            <td><span class="${action !== 'RAS' ? 'text-warning' : ''}" style="font-size:0.85rem;">${action}</span></td>
        `;
    }

    addGlobalAlert(source, severity, message, component = 'N/A', id = 'N/A', timestamp = null) {
        if (!this.data.globalAlerts) this.data.globalAlerts = [];
        
        // Normalisation de l'ID
        const alertId = (id && id !== 'N/A' && id !== 'null') ? id : null;
        
        // Vérification de doublon
        const isDuplicate = this.data.globalAlerts.some(a => {
            if (alertId && a.id === alertId) return true;
            return a.source === source && a.message === message;
        });

        if (isDuplicate) return;
        
        this.data.globalAlerts.push({
            id: alertId || 'N/A', 
            source, severity, message, component,
            timestamp: timestamp ? new Date(timestamp) : new Date()
        });
        this.updateBadge('badge-total-alerts', this.data.globalAlerts.length + ' alertes');
        
        // Rafraîchir la vue si on est sur l'onglet alertes
        if (this.currentView === 'alerts') {
            this.renderGlobalAlerts();
        }
        
        if (severity === 'CRITICAL' || severity === 'MAJOR' || severity === 'ERROR') {
            this.showNotification(`ALERTE CRITIQUE: ${source} - ${message}`, 'error');
        }
    }

    renderGlobalAlerts() {
        const body = document.getElementById('global-alerts-body');
        const severityFilter = document.getElementById('filter-alerts-severity').value;
        const searchQuery = document.getElementById('search-alerts').value.toLowerCase();

        if (!this.data.globalAlerts || this.data.globalAlerts.length === 0) {
            body.innerHTML = '<tr><td colspan="7" class="text-center">Aucune alerte en cours.</td></tr>';
            this.updateAlertSummary(0, 0, 0);
            return;
        }

        let filtered = this.data.globalAlerts;
        
        if (severityFilter !== 'all') {
            filtered = filtered.filter(a => a.severity === severityFilter);
        }
        
        if (searchQuery) {
            filtered = filtered.filter(a => 
                a.message.toLowerCase().includes(searchQuery) || 
                a.source.toLowerCase().includes(searchQuery) ||
                a.component.toLowerCase().includes(searchQuery)
            );
        }

        // Count totals for summary
        const criticals = this.data.globalAlerts.filter(a => ['CRITICAL', 'ERROR', 'MAJOR', 'Red'].includes(a.severity)).length;
        const warnings = this.data.globalAlerts.filter(a => ['WARNING', 'MINOR', 'Yellow'].includes(a.severity)).length;
        const infos = this.data.globalAlerts.length - criticals - warnings;
        this.updateAlertSummary(criticals, warnings, infos);

        body.innerHTML = '';
        const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp);
        
        if (sorted.length === 0) {
            body.innerHTML = '<tr><td colspan="6" class="text-center">Aucune alerte ne correspond aux filtres.</td></tr>';
            return;
        }

        sorted.forEach(a => {
            const row = document.createElement('tr');
            const sev = a.severity.toUpperCase();
            let badgeClass = 'badge';
            if (['CRITICAL', 'ERROR', 'MAJOR', 'Red'].includes(sev)) badgeClass += ' danger';
            else if (['WARNING', 'MINOR', 'Yellow'].includes(sev)) badgeClass += ' warning';
            else badgeClass += ' blue';
            
            row.innerHTML = `
                <td><code class="text-xs">${a.id.substring(0,8)}</code></td>
                <td><strong>${a.source}</strong></td>
                <td><span class="vc-tag" style="background:rgba(255,255,255,0.05);">${a.component}</span></td>
                <td><span class="${badgeClass}">${sev}</span></td>
                <td style="max-width:400px; white-space: normal; line-height:1.4;">${a.message}</td>
                <td class="font-mono text-xs">${a.timestamp.toLocaleString()}</td>
            `;
            body.appendChild(row);
        });
    }

    updateAlertSummary(crit, warn, info) {
        document.getElementById('alert-summary-critical').textContent = crit;
        document.getElementById('alert-summary-warning').textContent = warn;
        document.getElementById('alert-summary-info').textContent = info;
        
        const sidebarAlertCount = document.getElementById('sidebar-alert-count');
        if (sidebarAlertCount) {
            sidebarAlertCount.textContent = crit;
            sidebarAlertCount.className = crit > 0 ? 'val red' : 'val';
        }
    }

    async fetchDiagnostics() {
        const body = document.getElementById('diagnostics-body');
        body.innerHTML = '<tr><td colspan="5" class="text-center">Récupération des données...</td></tr>';

        try {
            const resp = await fetch('/api/diagnostics');
            const data = await resp.json();
            
            body.innerHTML = '';
            let count = 0;
            for (const [key, stat] of Object.entries(data.details)) {
                count++;
                const row = document.createElement('tr');
                const lastSeen = new Date(stat.last_time * 1000).toLocaleTimeString();
                const status = stat.errors > 0 ? 'FAIL' : 'OK';
                
                row.innerHTML = `
                    <td><code>${key}</code></td>
                    <td>${lastSeen}</td>
                    <td>${stat.count}</td>
                    <td><span class="${stat.errors > 0 ? 'text-danger' : ''}">${stat.errors}</span></td>
                    <td><span class="badge ${status === 'OK' ? 'success' : 'danger'}">${status}</span></td>
                `;
                body.appendChild(row);
            }
            this.updateBadge('badge-diag-items', count + ' items');
        } catch (e) {
            body.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Erreur: ${e.message}</td></tr>`;
        }
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
        
        const cpu = vc.global_metrics ? vc.global_metrics.cpu : 0;
        const ram = vc.global_metrics ? vc.global_metrics.ram : 0;

        // Update History for Trends
        if (!this.data.history[vc.vcenter]) this.data.history[vc.vcenter] = { cpu: [], ram: [] };
        this.data.history[vc.vcenter].cpu.push(cpu);
        this.data.history[vc.vcenter].ram.push(ram);
        if (this.data.history[vc.vcenter].cpu.length > 15) {
            this.data.history[vc.vcenter].cpu.shift();
            this.data.history[vc.vcenter].ram.shift();
        }

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
                    <span class="vc-stat-lbl">VMs Actives/OFF</span>
                </div>
            </div>
            <div class="vc-resource-usage">
                <div class="resource-row">
                    <div class="resource-label">
                        <span>CPU Global</span>
                        <div class="trend-container" id="trend-cpu-${cardId}"></div>
                        <span>${cpu}%</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill fill-cpu" style="width: ${cpu}%"></div>
                    </div>
                </div>
                <div class="resource-row">
                    <div class="resource-label">
                        <span>RAM Globale</span>
                        <div class="trend-container" id="trend-ram-${cardId}"></div>
                        <span>${ram}%</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill fill-ram" style="width: ${ram}%"></div>
                    </div>
                </div>
            </div>
            <div class="vc-card-footer">
                <span class="vc-action">Cliquer pour les détails</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
            </div>
        `;

        this.drawTrend(`trend-cpu-${cardId}`, this.data.history[vc.vcenter].cpu);
        this.drawTrend(`trend-ram-${cardId}`, this.data.history[vc.vcenter].ram);

        card.onclick = () => this.openModal(vc);
    }

    drawTrend(containerId, values) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = '';
        const max = 100;
        values.forEach(v => {
            const bar = document.createElement('div');
            bar.className = 'trend-bar';
            const height = Math.max(2, (v / max) * 100);
            bar.style.height = `${height}%`;
            if (v > 90) bar.style.background = 'var(--danger)';
            else if (v > 75) bar.style.background = 'var(--warning)';
            container.appendChild(bar);
        });
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

    openAddDeviceModal() {
        document.getElementById('modal-add-device').classList.add('active');
        document.getElementById('add-device-name').value = '';
        document.getElementById('add-device-ip').value = '';
    }

    async submitAddDevice() {
        const type = document.getElementById('add-device-type').value;
        const name = document.getElementById('add-device-name').value;
        const ip = document.getElementById('add-device-ip').value;
        const user = document.getElementById('add-device-user').value;
        const pwd = document.getElementById('add-device-pwd').value;
        const btn = document.getElementById('btn-submit-device');

        if (!type || !name || !ip) return;

        btn.textContent = 'Ajout en cours...';
        btn.disabled = true;

        try {
            const resp = await fetch('/api/config/add_device', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, name, ip, user, pwd })
            });
            const result = await resp.json();

            if (result.success) {
                this.showNotification('Équipement ajouté avec succès ! Redémarrage des flux...', 'success');
                document.getElementById('modal-add-device').classList.remove('active');
                
                // Restart streams to pick up new device
                setTimeout(() => {
                    this.refreshData();
                }, 1000);
            } else {
                this.showNotification(`Erreur: ${result.error}`, 'error');
            }
        } catch (e) {
            this.showNotification(`Erreur de connexion: ${e.message}`, 'error');
        } finally {
            btn.textContent = 'Ajouter';
            btn.disabled = false;
        }
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
            const element = type === 'vcenters' ? document.getElementById('vcenters-grid') : 
                           (type === 'clusters-detailed' ? document.getElementById('container-clusters-detailed') : 
                           (type === 'storage-detailed' ? document.getElementById('table-storage-detailed').parentElement :
                           document.getElementById('view-vmware')));
            
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
            // ... (keep existing)
        } else if (type === 'clusters-detailed' || type === 'storage-detailed') {
            const table = document.getElementById(type === 'clusters-detailed' ? 'table-clusters-detailed' : 'table-storage-detailed');
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                if (row.style.display !== 'none') {
                    dataToExport.push(Array.from(row.cells).map(cell => cell.innerText));
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

    updateSidebarStats() {
        const cpuAvg = document.getElementById('sidebar-cpu-avg');
        const alertCount = document.getElementById('sidebar-alert-count');
        
        // Calculate average CPU across all vCenters in data
        let totalCpu = 0;
        let count = 0;
        // This assumes we have access to the full data state, 
        // for now we can scrape from the UI or use a class property
        const cpuElements = document.querySelectorAll('.vc-resource-usage .resource-row:first-child span:last-child');
        cpuElements.forEach(el => {
            totalCpu += parseFloat(el.textContent);
            count++;
        });
        
        if (count > 0) cpuAvg.textContent = Math.round(totalCpu / count) + '%';
        
        const totalAlerts = this.data.globalAlerts ? this.data.globalAlerts.length : 0;
        alertCount.textContent = totalAlerts;
        alertCount.className = totalAlerts > 0 ? 'val red' : 'val';
    }

    renderHeatmapSquare(data) {
        const heatmap = document.getElementById('storage-heatmap');
        if (heatmap.querySelector('.empty-state')) heatmap.innerHTML = '';

        const squareId = `heatmap-sq-${data.name}`.replace(/\s+/g, '-');
        let square = document.getElementById(squareId);
        if (!square) {
            square = document.createElement('div');
            square.id = squareId;
            square.className = 'heatmap-square';
            heatmap.appendChild(square);
        }

        const usagePct = data.capacity ? data.capacity.used_pct : 0;
        const statusClass = data.state === 'DOWN' ? 'gray' : (usagePct > 90 ? 'red' : (usagePct > 75 ? 'yellow' : 'green'));
        
        square.className = `heatmap-square ${statusClass}`;
        // Show short name or index inside square
        const shortName = data.name.substring(0, 3).toUpperCase();
        square.innerHTML = `
            ${shortName}
            <div class="tooltip">
                <strong>${data.name}</strong><br>
                IP: ${data.ip}<br>
                Usage: ${usagePct}%<br>
                Status: ${data.state}
            </div>
        `;

        square.onclick = () => {
            const card = document.getElementById(`storage-card-${data.name}`.replace(/\s+/g, '-'));
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
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
