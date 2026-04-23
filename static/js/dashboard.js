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
            vmware: { total: 0, on: 0, off: 0, suspend: 0, clusters: [], datastores: [] },
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

        // Manual Refresh
        this.refreshBtn.addEventListener('click', () => {
            this.refreshAll();
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
        this.data.vmware = { total: 0, on: 0, off: 0, suspend: 0, clusters: [], datastores: [] };
        document.getElementById('clusters-grid').innerHTML = '<div class="empty-state">Rafraîchissement en cours...</div>';
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
        if (data.state === "UP") {
            // Update Counters
            this.data.vmware.total += data.vms.total;
            this.data.vmware.on += data.vms.on;
            this.data.vmware.off += data.vms.off;
            this.data.vmware.suspend += data.vms.suspend;
            this.updateVMwareCounters();

            // Handle Clusters
            if (data.clusters) {
                data.clusters.forEach(c => this.renderCluster(c));
                this.updateBadge('badge-clusters', document.querySelectorAll('.cluster-card').length + ' clusters');
            }

            // Handle Datastores
            if (data.datastores) {
                data.datastores.forEach(ds => this.renderDatastore(ds));
                this.updateBadge('badge-datastores', document.querySelectorAll('#datastores-body tr').length + ' datastores');
            }
        } else {
            this.showNotification(`Erreur vCenter: ${data.vcenter} (${data.error || 'Indisponible'})`, 'error');
        }
    }

    handleStorageUpdate(data) {
        const container = document.getElementById('storage-container');
        if (container.querySelector('.empty-state')) container.innerHTML = '';

        const card = document.createElement('div');
        card.className = 'array-card';
        
        const usagePct = data.capacity ? (data.capacity.used_gb / data.capacity.total_gb * 100).toFixed(1) : 0;
        const statusClass = usagePct > 90 ? 'red' : (usagePct > 75 ? 'yellow' : 'green');

        card.innerHTML = `
            <div class="array-header">
                <div>
                    <span class="array-type">${data.type || 'Storage'}</span>
                    <h4 style="margin-top:8px; font-size:1.2rem;">${data.name}</h4>
                    <p style="font-size:0.8rem; color:var(--text-muted);">${data.ip}</p>
                </div>
                <div class="status-dot ${data.status === 'error' ? 'red' : 'green'}"></div>
            </div>
            ${data.status === 'error' ? `
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
                        <span>${this.formatBytes(data.capacity.used_gb)}</span>
                        <span>Total: ${this.formatBytes(data.capacity.total_gb)}</span>
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
                <span class="cluster-name">${c.name}</span>
                <span class="cluster-vc">${c.vcenter_name}</span>
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

    showNotification(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = msg;
        document.getElementById('toast-container').appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new Dashboard();
});
