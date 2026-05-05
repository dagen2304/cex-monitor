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
            diagnostics: document.getElementById('view-diagnostics'),
            inventory: document.getElementById('view-inventory')
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

        // Inventory Search & Filters
        document.getElementById('search-inventory').addEventListener('input', (e) => this.filterTable('inventory-body', e.target.value));
        document.getElementById('filter-inventory-type').addEventListener('change', (e) => this.filterInventoryByType(e.target.value));

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
            diagnostics: { title: 'Diagnostics API', sub: 'État du cache et du monitoring' },
            inventory: { title: 'Inventaire des Équipements', sub: 'Gestion centralisée (CRUD)' }
        };
        
        if (titles[viewName]) {
            document.getElementById('current-view-title').textContent = titles[viewName].title;
            document.getElementById('current-view-subtitle').textContent = titles[viewName].sub;
        }

        if (viewName === 'diagnostics') this.fetchDiagnostics();
        if (viewName === 'alerts') this.renderGlobalAlerts();
        if (viewName === 'capacity') this.fetchCapacityReport();
        if (viewName === 'inventory') this.loadInventory();
        
        this.currentView = viewName;
    }

    async loadInventory() {
        const body = document.getElementById('inventory-body');
        body.innerHTML = '<tr><td colspan="7" class="text-center">Chargement de l\'inventaire...</td></tr>';
        
        try {
            const resp = await fetch('/api/config/devices');
            const devices = await resp.json();
            this.renderInventory(devices);
        } catch (e) {
            body.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Erreur: ${e.message}</td></tr>`;
        }
    }

    renderInventory(devices) {
        const body = document.getElementById('inventory-body');
        body.innerHTML = '';
        
        if (devices.length === 0) {
            body.innerHTML = '<tr><td colspan="7" class="text-center">Aucun équipement configuré.</td></tr>';
            document.getElementById('badge-inventory-count').textContent = '0';
            return;
        }

        devices.forEach(d => {
            const row = document.createElement('tr');
            row.dataset.type = d.type;
            row.innerHTML = `
                <td><span class="vc-tag" style="background:rgba(255,255,255,0.1); color:#fff; text-transform:uppercase; font-size:0.7rem;">${d.type}</span></td>
                <td><strong>${d.name}</strong></td>
                <td class="font-mono">${d.ip}</td>
                <td>${d.user || '--'}</td>
                <td class="font-mono">${d.port || '--'}</td>
                <td><span class="text-xs">${d.connection_mode || 'REST'}</span></td>
                <td style="text-align: right;">
                    <div style="display: flex; gap: 8px; justify-content: flex-end;">
                        <button class="btn-icon-sm" onclick="dashboard.editDevice(${d.id})" title="Modifier">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="btn-icon-sm danger" onclick="dashboard.deleteDevice(${d.id}, '${d.name}')" title="Supprimer">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                </td>
            `;
            body.appendChild(row);
        });
        
        document.getElementById('badge-inventory-count').textContent = devices.length;
    }

    async editDevice(id) {
        try {
            const resp = await fetch(`/api/config/devices/${id}`);
            const d = await resp.json();
            
            // Re-use Add modal but change it for Update
            document.getElementById('modal-add-device').classList.add('active');
            document.querySelector('#modal-add-device h2').textContent = 'Modifier Équipement';
            document.querySelector('#modal-add-device p').textContent = `ID: ${id} - Mise à jour des paramètres`;
            document.getElementById('btn-submit-device').textContent = 'Enregistrer les modifications';
            
            // Fill fields
            document.getElementById('add-device-type').value = d.type;
            document.getElementById('add-device-name').value = d.name;
            document.getElementById('add-device-ip').value = d.ip;
            document.getElementById('add-device-port').value = d.port || '';
            document.getElementById('add-device-mode').value = d.connection_mode || 'REST';
            document.getElementById('add-device-extra').value = d.extra_params || '';
            document.getElementById('add-device-user').value = d.user || '';
            document.getElementById('add-device-pwd').value = ''; // Don't show password
            
            // Store ID in form for submit
            document.getElementById('form-add-device').dataset.editId = id;
        } catch (e) {
            this.showNotification(`Erreur lors de la récupération: ${e.message}`, 'error');
        }
    }

    async deleteDevice(id, name) {
        if (!confirm(`Voulez-vous vraiment supprimer l'équipement "${name}" ?`)) return;
        
        try {
            const resp = await fetch(`/api/config/devices/${id}`, { method: 'DELETE' });
            const result = await resp.json();
            if (result.success) {
                this.showNotification(`Équipement ${name} supprimé.`, 'success');
                this.loadInventory();
            } else {
                this.showNotification(`Erreur: ${result.error}`, 'error');
            }
        } catch (e) {
            this.showNotification(`Erreur de connexion: ${e.message}`, 'error');
        }
    }

    filterInventoryByType(type) {
        const rows = document.querySelectorAll('#inventory-body tr');
        rows.forEach(row => {
            if (type === 'all' || row.dataset.type === type) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    getWeekNumber(d) {
        d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return weekNo;
    }

    async fetchCapacityReport() {
        const body = document.getElementById('capacity-indicators-body');
        if (!body) return;
        
        body.innerHTML = `
            <tr class="group-header" style="background: #fdf2f2; font-weight: 800; color: #000;">
                <td colspan="3" style="padding: 8px 20px; color: #000; font-size: 1.1rem; border-bottom: 2px solid #000;">Utilisation réel PF VMWARE</td>
            </tr>
        `;

        try {
            const resp = await fetch('/api/capacity/report');
            const dataObj = await resp.json();
            const data = dataObj.report || [];

            // Week Number
            const now = new Date();
            const weekNum = this.getWeekNumber(now);
            const weekStr = "W" + (weekNum < 10 ? "0" + weekNum : weekNum);
            
            const weekCol = document.getElementById('header-week-col');
            if (weekCol) weekCol.textContent = weekStr;
            
            const weekBadge = document.getElementById('capacity-current-week');
            if (weekBadge) weekBadge.textContent = weekStr;

            if (dataObj.timestamp) {
                const lastRun = document.getElementById('capacity-last-run');
                if (lastRun) lastRun.textContent = new Date(dataObj.timestamp).toLocaleDateString();
            }

            // Definitions mapping (Label, Target, Search Keyword, Metric)
            const vmwareIndicators = [
                { label: '% of CPU (All platform) - vCenter IN/ZSMART', target: '<=50%', device: 'vCenter IN/ZSMART', metric: 'cpu_usage' },
                { label: '% of memory used (RAM) (All platform) - vCenter IN/ZSMART', target: '< 50%', device: 'vCenter IN/ZSMART', metric: 'ram_usage' },
                { label: '% of CPU (All platform) - vCenter ODC', target: '<=50%', device: 'vCenter ODC', metric: 'cpu_usage' },
                { label: '% of memory used (RAM) (All platform) - vCenter ODC', target: '< 50%', device: 'vCenter ODC', metric: 'ram_usage' },
                { label: '% of CPU (All platform) - vCenter-67-Agence', target: '<=50%', device: 'vCenter-67-Agence', metric: 'cpu_usage' },
                { label: '% of memory used (RAM) (All platform) - vCenter-67-Agence', target: '< 50%', device: 'vCenter-67-Agence', metric: 'ram_usage' },
                { label: '% of CPU (All platform) - vCenter67-MKP', target: '<=50%', device: 'vCenter67-MKP', metric: 'cpu_usage' },
                { label: '% of memory used (RAM) (All platform) - vCenter67-MKP', target: '< 50%', device: 'vCenter67-MKP', metric: 'ram_usage' },
                { label: '% of CPU (All platform) - vCenter67-NDG', target: '<=50%', device: 'vCenter67-NDG', metric: 'cpu_usage' },
                { label: '% of memory used (RAM) (All platform) - vCenter67-NDG', target: '< 50%', device: 'vCenter67-NDG', metric: 'ram_usage' },
                { label: '% of CPU (All platform) - vCenter67-SVI', target: '<=50%', device: 'vCenter67-SVI', metric: 'cpu_usage' },
                { label: '% of memory used (RAM) (All platform) - vCenter67-SVI', target: '< 50%', device: 'vCenter67-SVI', metric: 'ram_usage' },
                { label: '% of CPU (All platform) - vCenter80-MKP', target: '<=50%', device: 'vCenter80-MKP', metric: 'cpu_usage' },
                { label: '% of memory used (RAM) (All platform) - vCenter80-MKP', target: '< 50%', device: 'vCenter80-MKP', metric: 'ram_usage' },
                { label: '% of CPU (All platform) - vCenter80-NDG', target: '<=50%', device: 'vCenter80-NDG', metric: 'cpu_usage' },
                { label: '% of memory used (RAM) (All platform) - vCenter80-NDG', target: '< 50%', device: 'vCenter80-NDG', metric: 'ram_usage' },
                { label: '% of CPU (All platform) - vCenterLab', target: '<=50%', device: 'vCenterLab', metric: 'cpu_usage' },
                { label: '% of memory used (RAM) (All platform) - vCenterLab', target: '< 50%', device: 'vCenterLab', metric: 'ram_usage' }
            ];

            const storageIndicators = [
                { label: '% Capacity usage - PowerStore-IN', target: '<=80%', device: 'PowerStore-IN', metric: 'storage_used_pct' },
                { label: '% Capacity usage - PowerStore-MKP', target: '<=80%', device: 'PowerStore-MKP', metric: 'storage_used_pct' },
                { label: '% Capacity usage - DataDomain-4200-MKP', target: '<=80%', device: 'DataDomain-4200-MKP', metric: 'storage_used_pct' },
                { label: '% Capacity usage - Scality-Ring', target: '<=80%', device: 'Scality-Ring', metric: 'storage_used_pct' },
                { label: '% Capacity usage - DataDomain-9400-MKP', target: '<=80%', device: 'DataDomain-9400-MKP', metric: 'storage_used_pct' },
                { label: '% Capacity usage - DataDomain-9400-NDG', target: '<=80%', device: 'DataDomain-9400-NDG', metric: 'storage_used_pct' },
                { label: '% Capacity usage - Dorado-NDG', target: '<=80%', device: 'Dorado-NDG', metric: 'storage_used_pct' },
                { label: '% Subscription', target: '<=600%', device: 'Dorado-NDG', metric: 'subscription_pct' },
                { label: '% Capacity usage - Dorado-MKP', target: '<=80%', device: 'Dorado-MKP', metric: 'storage_used_pct' },
                { label: '% Subscription', target: '<=600%', device: 'Dorado-MKP', metric: 'subscription_pct' },
                { label: '% Capacity usage - Unity-400-OCS-DR', target: '<=80%', device: 'Unity-400-OCS-DR', metric: 'storage_used_pct' },
                { label: '% Capacity usage - Unity-400-OCS-PR', target: '<=80%', device: 'Unity-400-OCS-PR', metric: 'storage_used_pct' },
                { label: '% Capacity usage - Unity-480F-DR', target: '<=80%', device: 'Unity-480F-DR', metric: 'storage_used_pct' },
                { label: '% Capacity usage - Unity-480F-PR', target: '<=80%', device: 'Unity-480F-PR', metric: 'storage_used_pct' },
                { label: '% Capacity usage - Unity-350-IN-PR', target: '<=80%', device: 'Unity-350-IN-PR', metric: 'storage_used_pct' },
                { label: '% Capacity usage - Unity-350-IN-DR', target: '<=80%', device: 'Unity-350-IN-DR', metric: 'storage_used_pct' },
                { label: '% Capacity usage - Unity-350-NETACT-PR', target: '<=80%', device: 'Unity-350-NETACT-PR', metric: 'storage_used_pct' },
                { label: '% Capacity usage - Unity-300-NETACT-BKP', target: '<=80%', device: 'Unity-300-NETACT-BKP', metric: 'storage_used_pct' },
                { label: '% Capacity usage - PowerStore-NDG', target: '<=80%', device: 'PowerStore-NDG', metric: 'storage_used_pct' }
            ];

            // Render VMware
            vmwareIndicators.forEach(ind => this.renderIndicatorRow(body, ind, data));

            // Render Storage Header
            const storageHeader = document.createElement('tr');
            storageHeader.innerHTML = '<td colspan="3" style="padding: 8px 20px; color: #000; font-size: 1.1rem; border-bottom: 2px solid #000; background: #fdf2f2; font-weight: 800;">Utilisation Stockage / Baies</td>';
            body.appendChild(storageHeader);

            // Render Storage
            storageIndicators.forEach(ind => this.renderIndicatorRow(body, ind, data));

            // Global Status
            const criticals = body.querySelectorAll('.val-red').length;
            const globalStatus = document.getElementById('capacity-global-status');
            if (globalStatus) {
                globalStatus.textContent = criticals > 0 ? `${criticals} Alertes` : 'Optimal';
                globalStatus.className = criticals > 0 ? 'red' : 'green';
            }

        } catch (e) {
            console.error('Error fetching capacity report:', e);
            body.innerHTML = `<tr><td colspan="3" class="text-center text-danger">Erreur: ${e.message}</td></tr>`;
        }
    }

    renderIndicatorRow(body, ind, data) {
        // Normalisation pour un matching plus robuste
        const normalize = (s) => s.toString().toUpperCase().replace(/\s+/g, ' ').trim();
        const keyword = normalize(ind.device);
        const exclude = ind.exclude ? normalize(ind.exclude) : null;

        const point = data.find(d => {
            const name = normalize(d.device_name);
            const matchesKeyword = name.includes(keyword);
            const isNotExcluded = exclude ? !name.includes(exclude) : true;
            return matchesKeyword && isNotExcluded && d.metric === ind.metric;
        });

        if (!point) {
            console.warn(`No match found for indicator: ${ind.label} (Keyword: ${keyword}, Metric: ${ind.metric})`);
        }

        const row = document.createElement('tr');
        const val = point ? point.current : null;
        const valStr = val !== null ? val.toFixed(2).replace('.', ',') + '%' : '--';
        
        let isCritical = false;
        if (val !== null) {
            const targetVal = parseFloat(ind.target.replace(/[^\d.]/g, ''));
            if (ind.target.includes('<=') && val > targetVal) isCritical = true;
            else if (ind.target.includes('<') && val >= targetVal) isCritical = true;
        }

        row.innerHTML = `
            <td style="color: #000; padding-left: 30px; border: 1px solid #ddd;">${ind.label}</td>
            <td class="target-cell" style="border: 1px solid #ddd; text-align: center; background: #f8f9fa;">${ind.target}</td>
            <td class="val-cell ${isCritical ? 'val-red' : 'val-green'}" style="border: 1px solid #ddd; text-align: center; font-weight: 600;">${valStr}</td>
        `;
        body.appendChild(row);
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
        
        console.log('Starting VMware stream...');
        this.sse.vmware = new EventSource('/api/vmware/stream');
        
        this.sse.vmware.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleVMwareUpdate(data);
            } catch (e) {
                console.error('Error parsing VMware SSE data:', e);
            }
        };

        this.sse.vmware.addEventListener('end', () => {
            console.log('VMware stream ended gracefully');
            this.sse.vmware.close();
        });

        this.sse.vmware.onerror = (err) => {
            console.error('VMware stream error:', err);
            this.sse.vmware.close();
            this.showNotification('Flux VMware interrompu. Reconnexion dans 10s...', 'warning');
            setTimeout(() => this.startVMwareStream(), 10000);
        };
    }

    startStorageStream() {
        if (this.sse.storage) this.sse.storage.close();

        console.log('Starting Storage stream...');
        this.sse.storage = new EventSource('/api/storage/stream');

        this.sse.storage.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleStorageUpdate(data);
            } catch (e) {
                console.error('Error parsing Storage SSE data:', e);
            }
        };

        this.sse.storage.addEventListener('end', () => {
            console.log('Storage stream ended gracefully');
            this.sse.storage.close();
        });

        this.sse.storage.onerror = (err) => {
            console.error('Storage stream error:', err);
            this.sse.storage.close();
            this.showNotification('Flux Stockage interrompu. Reconnexion dans 10s...', 'warning');
            setTimeout(() => this.startStorageStream(), 10000);
        };
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
        const modal = document.getElementById('modal-add-device');
        modal.classList.add('active');
        
        // Reset modal title and button for "Add" mode
        document.querySelector('#modal-add-device h2').textContent = 'Nouvel Équipement';
        document.querySelector('#modal-add-device p').textContent = 'Enregistrement sécurisé en base de données';
        document.getElementById('btn-submit-device').textContent = 'Confirmer l\'ajout';
        
        // Reset form
        document.getElementById('form-add-device').reset();
        delete document.getElementById('form-add-device').dataset.editId;
    }

    async submitAddDevice() {
        const type = document.getElementById('add-device-type').value;
        const name = document.getElementById('add-device-name').value;
        const ip = document.getElementById('add-device-ip').value;
        const port = document.getElementById('add-device-port').value;
        const connection_mode = document.getElementById('add-device-mode').value;
        const extra_params = document.getElementById('add-device-extra').value;
        const user = document.getElementById('add-device-user').value;
        const pwd = document.getElementById('add-device-pwd').value;
        const btn = document.getElementById('btn-submit-device');
        const editId = document.getElementById('form-add-device').dataset.editId;

        if (!type || !name || !ip) return;

        btn.textContent = editId ? 'Mise à jour...' : 'Ajout en cours...';
        btn.disabled = true;

        try {
            const url = editId ? `/api/config/devices/${editId}` : '/api/config/add_device';
            const method = editId ? 'PUT' : 'POST';
            
            const resp = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    type, name, ip, user, pwd, 
                    port: port ? parseInt(port) : null, 
                    connection_mode, extra_params 
                })
            });
            const result = await resp.json();

            if (result.success) {
                this.showNotification(result.message || 'Succès !', 'success');
                document.getElementById('modal-add-device').classList.remove('active');
                
                if (this.currentView === 'inventory') {
                    this.loadInventory();
                } else {
                    // If we added a device from another view, we might want to refresh data
                    this.refreshAll();
                }
            } else {
                this.showNotification(`Erreur: ${result.error}`, 'error');
            }
        } catch (e) {
            this.showNotification(`Erreur de connexion: ${e.message}`, 'error');
        } finally {
            btn.textContent = editId ? 'Enregistrer les modifications' : 'Confirmer l\'ajout';
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
                           (type === 'capacity' ? document.getElementById('view-capacity') :
                           document.getElementById('view-vmware'))));
            
            this.showNotification('Génération de la capture...');
            const canvas = await html2canvas(element, { 
                backgroundColor: '#050508',
                scale: 2 // Higher quality
            });
            const link = document.createElement('a');
            link.download = `${filename}.png`;
            link.href = canvas.toDataURL();
            link.click();
            return;
        }

        let dataToExport = [];
        if (type === 'capacity') {
            const table = document.getElementById('table-capacity-indicators');
            const head = table.querySelector('thead');
            const body = table.querySelector('tbody');
            
            // Header
            dataToExport.push(Array.from(head.querySelectorAll('th')).map(th => th.innerText));
            
            // Body
            body.querySelectorAll('tr').forEach(tr => {
                if (tr.classList.contains('group-header')) {
                    // Group headers have one cell with colspan
                    dataToExport.push([tr.innerText, '', '']);
                } else {
                    dataToExport.push(Array.from(tr.querySelectorAll('td')).map(td => td.innerText));
                }
            });
        } else if (type === 'vcenters') {
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

    // --- INVENTORY CRUD ---

    async loadInventory() {
        const body = document.getElementById('inventory-body');
        if (!body) return;
        body.innerHTML = '<tr><td colspan="7" class="text-center">Chargement de l\'inventaire...</td></tr>';
        
        try {
            const resp = await fetch('/api/config/devices');
            const devices = await resp.json();
            this.renderInventory(devices);
        } catch (e) {
            body.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Erreur: ${e.message}</td></tr>`;
        }
    }

    renderInventory(devices) {
        const body = document.getElementById('inventory-body');
        if (!body) return;
        body.innerHTML = '';
        
        if (devices.length === 0) {
            body.innerHTML = '<tr><td colspan="7" class="text-center">Aucun équipement configuré.</td></tr>';
            document.getElementById('badge-inventory-count').textContent = '0';
            return;
        }

        devices.forEach(d => {
            const row = document.createElement('tr');
            row.dataset.type = d.type;
            row.innerHTML = `
                <td><span class="vc-tag" style="background:rgba(255,255,255,0.1); color:#fff; text-transform:uppercase; font-size:0.7rem;">${d.type}</span></td>
                <td><strong>${d.name}</strong></td>
                <td class="font-mono">${d.ip}</td>
                <td>${d.user || '--'}</td>
                <td class="font-mono">${d.port || '--'}</td>
                <td><span class="text-xs">${d.connection_mode || 'REST'}</span></td>
                <td style="text-align: right;">
                    <div style="display: flex; gap: 8px; justify-content: flex-end;">
                        <button class="btn-icon-sm" onclick="dashboard.editDevice(${d.id})" title="Modifier">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="btn-icon-sm danger" onclick="dashboard.deleteDevice(${d.id}, '${d.name}')" title="Supprimer">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                </td>
            `;
            body.appendChild(row);
        });
        
        document.getElementById('badge-inventory-count').textContent = devices.length;
    }

    async editDevice(id) {
        try {
            const resp = await fetch(`/api/config/devices/${id}`);
            const d = await resp.json();
            
            document.getElementById('modal-add-device').classList.add('active');
            document.querySelector('#modal-add-device h2').textContent = 'Modifier Équipement';
            document.querySelector('#modal-add-device p').textContent = `ID: ${id} - Mise à jour des paramètres`;
            document.getElementById('btn-submit-device').textContent = 'Enregistrer les modifications';
            
            document.getElementById('add-device-type').value = d.type;
            document.getElementById('add-device-name').value = d.name;
            document.getElementById('add-device-ip').value = d.ip;
            document.getElementById('add-device-port').value = d.port || '';
            document.getElementById('add-device-mode').value = d.connection_mode || 'REST';
            document.getElementById('add-device-extra').value = d.extra_params || '';
            document.getElementById('add-device-user').value = d.user || '';
            document.getElementById('add-device-pwd').value = '';
            
            document.getElementById('form-add-device').dataset.editId = id;
        } catch (e) {
            this.showNotification(`Erreur lors de la récupération: ${e.message}`, 'error');
        }
    }

    async deleteDevice(id, name) {
        if (!confirm(`Voulez-vous vraiment supprimer l'équipement "${name}" ?`)) return;
        
        try {
            const resp = await fetch(`/api/config/devices/${id}`, { method: 'DELETE' });
            const result = await resp.json();
            if (result.success) {
                this.showNotification(`Équipement ${name} supprimé.`, 'success');
                this.loadInventory();
            } else {
                this.showNotification(`Erreur: ${result.error}`, 'error');
            }
        } catch (e) {
            this.showNotification(`Erreur de connexion: ${e.message}`, 'error');
        }
    }

    filterInventoryByType(type) {
        const rows = document.querySelectorAll('#inventory-body tr');
        rows.forEach(row => {
            if (type === 'all' || row.dataset.type === type) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new Dashboard();
});
