import ssl
import logging
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import atexit
from app.config import Config

def collect_properties(si, vimtype, properties):
    """
    Fonction générique ultra-rapide pour récupérer des propriétés spécifiques
    d'un type d'objet via le PropertyCollector.
    """
    collector = si.content.propertyCollector
    container = si.content.viewManager.CreateContainerView(si.content.rootFolder, vimtype, True)
    
    obj_spec = vim.PropertyCollector.ObjectSpec()
    obj_spec.obj = container
    obj_spec.skip = True
    
    traversal_spec = vim.PropertyCollector.TraversalSpec()
    traversal_spec.name = 'traverseEntities'
    traversal_spec.path = 'view'
    traversal_spec.skip = False
    traversal_spec.type = container.__class__
    obj_spec.selectSet = [traversal_spec]
    
    property_spec = vim.PropertyCollector.PropertySpec()
    property_spec.type = vimtype[0]
    property_spec.pathSet = properties
    
    filter_spec = vim.PropertyCollector.FilterSpec()
    filter_spec.objectSet = [obj_spec]
    filter_spec.propSet = [property_spec]
    
    props = collector.RetrievePropertiesEx([filter_spec], vim.PropertyCollector.RetrieveOptions())
    
    data = []
    if props:
        for obj in props.objects:
            properties_dict = {'obj': obj.obj}
            if obj.propSet:
                for prop in obj.propSet:
                    properties_dict[prop.name] = prop.val
            data.append(properties_dict)
            
        while props.token:
            props = collector.ContinueRetrievePropertiesEx(token=props.token)
            for obj in props.objects:
                properties_dict = {'obj': obj.obj}
                if obj.propSet:
                    for prop in obj.propSet:
                        properties_dict[prop.name] = prop.val
                data.append(properties_dict)
                
    container.Destroy()
    return data

def _get_clusters_data(si):
    cluster_props = ['name', 'configuration.drsConfig.enabled', 'configuration.dasConfig.enabled', 'overallStatus', 'host', 'datastore']
    clusters = collect_properties(si, [vim.ClusterComputeResource], cluster_props)
    
    host_to_cluster = {}
    cluster_data_map = {}
    for c in clusters:
        c_name = c.get('name', 'Unknown')
        cluster_data_map[c['obj']] = {
            "name": c_name,
            "drs_enabled": c.get('configuration.drsConfig.enabled', False),
            "ha_enabled": c.get('configuration.dasConfig.enabled', False),
            "status": str(c.get('overallStatus', 'gray')),
            "total_hosts": 0,
            "maint_hosts": 0,
            "total_vms": 0,
            "cpu_mhz": 0,
            "used_cpu": 0,
            "mem_bytes": 0,
            "used_mem": 0,
            "ds_list": c.get('datastore', []),
            "storage_cap_bytes": 0,
            "storage_free_bytes": 0
        }
        if 'host' in c:
            for h_moref in c['host']:
                host_to_cluster[h_moref] = c['obj']
    return cluster_data_map, host_to_cluster

def _get_hosts_data(si, cluster_data_map, host_to_cluster):
    host_props = [
        'name', 'runtime.connectionState', 'runtime.inMaintenanceMode',
        'summary.hardware.cpuMhz', 'summary.hardware.numCpuCores', 'summary.hardware.memorySize',
        'summary.quickStats.overallCpuUsage', 'summary.quickStats.overallMemoryUsage',
        'summary.config.product.version', 'summary.overallStatus', 'overallStatus', 'vm'
    ]
    hosts = collect_properties(si, [vim.HostSystem], host_props)
    
    host_list = []
    for h in hosts:
        h_obj = h['obj']
        h_name = h.get('name', 'Unknown')
        h_state = str(h.get('runtime.connectionState', 'disconnected'))
        in_maintenance = h.get('runtime.inMaintenanceMode', False)
        
        parent_cluster_obj = host_to_cluster.get(h_obj)
        c_name = cluster_data_map[parent_cluster_obj]["name"] if parent_cluster_obj else "-"
        
        if parent_cluster_obj:
            cluster_data_map[parent_cluster_obj]["total_hosts"] += 1
            if in_maintenance:
                cluster_data_map[parent_cluster_obj]["maint_hosts"] += 1
                
        cpu_hz = h.get('summary.hardware.cpuMhz', 0)
        num_vms = len(h.get('vm', []))
        
        if parent_cluster_obj:
            cluster_data_map[parent_cluster_obj]["total_vms"] += num_vms
        
        host_list.append({
            "name": h_name,
            "cluster_name": c_name,
            "state": h_state,
            "in_maintenance": in_maintenance,
            "version": h.get('summary.config.product.version', 'N/A'),
            "cpu_ghz": round(cpu_hz / 1000, 2),
            "num_vms": num_vms,
            "hw_status": str(h.get('summary.overallStatus', 'unknown')),
            "overall_status": str(h.get('overallStatus', 'gray')),
            "ssh_running": False,
            "ntp_running": False
        })
        
        if h_state == "connected" and parent_cluster_obj:
            cpu_cores = h.get('summary.hardware.numCpuCores', 0)
            used_cpu = h.get('summary.quickStats.overallCpuUsage') or 0
            mem_bytes = h.get('summary.hardware.memorySize', 0)
            used_mem = h.get('summary.quickStats.overallMemoryUsage') or 0
            
            cluster_data_map[parent_cluster_obj]["cpu_mhz"] += (cpu_cores * cpu_hz)
            cluster_data_map[parent_cluster_obj]["used_cpu"] += used_cpu
            cluster_data_map[parent_cluster_obj]["mem_bytes"] += mem_bytes
            cluster_data_map[parent_cluster_obj]["used_mem"] += used_mem
            
    return host_list

def _get_vms_data(si):
    vm_props = ['name', 'runtime.powerState']
    vms = collect_properties(si, [vim.VirtualMachine], vm_props)
    
    vm_stats = {"on": 0, "off": 0, "suspend": 0, "total": len(vms)}
    vm_list = []
    
    for vm in vms:
        state_val = vm.get('runtime.powerState')
        state_str = "SUSPEND"
        if state_val == vim.VirtualMachine.PowerState.poweredOn:
            vm_stats["on"] += 1
            state_str = "ON"
        elif state_val == vim.VirtualMachine.PowerState.poweredOff:
            vm_stats["off"] += 1
            state_str = "OFF"
        else:
            vm_stats["suspend"] += 1
            
        vm_list.append({
            "name": vm.get('name', 'Unknown'),
            "state": state_str
        })
    return vm_stats, vm_list

def _get_datastores_data(si, cluster_data_map):
    ds_props = ['name', 'summary.capacity', 'summary.freeSpace']
    datastores = collect_properties(si, [vim.Datastore], ds_props)
    
    ds_metrics = {}
    datastores_list = []
    for ds in datastores:
        ds_obj = ds['obj']
        cap_bytes = ds.get('summary.capacity', 0)
        free_bytes = ds.get('summary.freeSpace', 0)
        ds_metrics[ds_obj] = {'cap': cap_bytes, 'free': free_bytes}
        
        if cap_bytes > 0:
            cap_gb = cap_bytes / (1024**3)
            free_gb = free_bytes / (1024**3)
            usage_pct = round(((cap_bytes - free_bytes) / cap_bytes * 100), 1)
            datastores_list.append({
                "name": ds.get('name', 'Unknown'),
                "capacity_gb": round(cap_gb, 2),
                "free_gb": round(free_gb, 2),
                "usage_pct": usage_pct
            })
            
    # Update cluster storage stats
    clusters_list = []
    for c_obj, c_stats in cluster_data_map.items():
        for ds_moref in c_stats["ds_list"]:
            if ds_moref in ds_metrics:
                c_stats["storage_cap_bytes"] += ds_metrics[ds_moref]["cap"]
                c_stats["storage_free_bytes"] += ds_metrics[ds_moref]["free"]
        
        cpu_pct = round((c_stats["used_cpu"] / c_stats["cpu_mhz"] * 100), 1) if c_stats["cpu_mhz"] > 0 else 0
        mem_pct = round(((c_stats["used_mem"] / 1024) / (c_stats["mem_bytes"] / (1024**3)) * 100), 1) if c_stats["mem_bytes"] > 0 else 0
        storage_used_bytes = c_stats["storage_cap_bytes"] - c_stats["storage_free_bytes"]
        storage_pct = round((storage_used_bytes / c_stats["storage_cap_bytes"] * 100), 1) if c_stats["storage_cap_bytes"] > 0 else 0
        
        clusters_list.append({
            "name": c_stats["name"],
            "cpu_usage_pct": cpu_pct,
            "mem_usage_pct": mem_pct,
            "storage_usage_pct": storage_pct,
            "drs_enabled": c_stats["drs_enabled"],
            "ha_enabled": c_stats["ha_enabled"],
            "status": c_stats["status"],
            "total_hosts": c_stats["total_hosts"],
            "maint_hosts": c_stats["maint_hosts"],
            "total_vms": c_stats["total_vms"]
        })
    return datastores_list, clusters_list

def _get_alerts(si, vcenter_ip):
    alerts = []
    try:
        alarms = si.content.rootFolder.triggeredAlarmState
        if alarms:
            for alarm in alarms:
                if alarm.overallStatus in [vim.ManagedEntity.Status.red, vim.ManagedEntity.Status.yellow]:
                    alerts.append({
                        "id": str(alarm.key),
                        "severity": "CRITICAL" if alarm.overallStatus == vim.ManagedEntity.Status.red else "WARNING",
                        "message": f"Alarme sur {getattr(alarm.entity, 'name', 'Inconnu')}",
                        "timestamp": str(alarm.time),
                        "component": alarm.entity.__class__.__name__
                    })
    except Exception as e:
        logging.error(f"Erreur lors de la récupération des alarmes vCenter {vcenter_ip}: {e}")
    return alerts

def fetch_vmware_stats(vcenter_ip, username, password, port=443, extra_params=None):
    """Se connecte au vCenter et retourne un dictionnaire formaté pour le Dashboard, ultra-rapide."""
    data = {
        "status": "success", "vcenter_ip": vcenter_ip, "clusters": [], "host_list": [],
        "vm_list": [], "vms": {"on": 0, "off": 0, "suspend": 0, "total": 0},
        "datastores": [], "alerts": [], "global_metrics": {"cpu": 0, "ram": 0, "storage": 0}
    }

    try:
        if Config.VERIFY_SSL:
            context = ssl.create_default_context(cafile=Config.CA_BUNDLE)
        else:
            context = ssl._create_unverified_context()
            
        port = port or 443
        si = SmartConnect(host=vcenter_ip, user=username, pwd=password, port=port, sslContext=context)
        atexit.register(Disconnect, si)

        cluster_map, host_to_cluster = _get_clusters_data(si)
        data["host_list"] = _get_hosts_data(si, cluster_map, host_to_cluster)
        data["vms"], data["vm_list"] = _get_vms_data(si)
        data["datastores"], data["clusters"] = _get_datastores_data(si, cluster_map)
        data["alerts"] = _get_alerts(si, vcenter_ip)

        # Global metrics calculation
        total_cpu_mhz = sum(c["cpu_mhz"] for c in cluster_map.values())
        total_used_cpu = sum(c["used_cpu"] for c in cluster_map.values())
        total_mem_bytes = sum(c["mem_bytes"] for c in cluster_map.values())
        total_used_mem = sum(c["used_mem"] for c in cluster_map.values())
        total_storage_cap = sum(c["storage_cap_bytes"] for c in cluster_map.values())
        total_storage_free = sum(c["storage_free_bytes"] for c in cluster_map.values())

        data["global_metrics"]["cpu"] = round((total_used_cpu / total_cpu_mhz * 100), 1) if total_cpu_mhz > 0 else 0
        data["global_metrics"]["ram"] = round(((total_used_mem / 1024) / (total_mem_bytes / (1024**3)) * 100), 1) if total_mem_bytes > 0 else 0
        data["global_metrics"]["storage"] = round(((total_storage_cap - total_storage_free) / total_storage_cap * 100), 1) if total_storage_cap > 0 else 0

    except (ssl.SSLError, ssl.CertificateError) as e:
        data["status"] = "error"
        data["error_msg"] = f"Erreur SSL/Certificat: {e}. Vérifiez VERIFY_SSL dans .env"
    except (ConnectionRefusedError, TimeoutError, ConnectionError) as e:
        data["status"] = "error"
        data["error_msg"] = f"Erreur réseau (Timeout/Refused): {e}"
    except vim.fault.InvalidLogin:
        data["status"] = "error"
        data["error_msg"] = "Identifiants vCenter incorrects"
    except Exception as e:
        data["status"] = "error"
        data["error_msg"] = f"Erreur inattendue: {type(e).__name__}: {e}"

    return data
