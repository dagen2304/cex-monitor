import ssl
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim
import atexit

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

def fetch_vmware_stats(vcenter_ip, username, password):
    """Se connecte au vCenter et retourne un dictionnaire formaté pour le Dashboard, ultra-rapide."""
    data = {
        "status": "success",
        "vcenter_ip": vcenter_ip,
        "clusters": [],
        "host_list": [],
        "vm_list": [],
        "vms": {"on": 0, "off": 0, "suspend": 0, "total": 0},
        "datastores": [],
        "global_metrics": {"cpu": 0, "ram": 0, "storage": 0}
    }

    try:
        context = ssl._create_unverified_context()
        si = SmartConnect(host=vcenter_ip, user=username, pwd=password, sslContext=context)
        atexit.register(Disconnect, si)

        # --- 1. CLUSTERS ---
        cluster_props = ['name', 'configuration.drsConfig.enabled', 'configuration.dasConfig.enabled', 'overallStatus', 'host', 'datastore']
        clusters = collect_properties(si, [vim.ClusterComputeResource], cluster_props)
        
        # Mapping Host_MoRef -> Cluster
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

        # --- 2. HOSTS ---
        host_props = [
            'name', 'runtime.connectionState', 'runtime.inMaintenanceMode',
            'summary.hardware.cpuMhz', 'summary.hardware.numCpuCores', 'summary.hardware.memorySize',
            'summary.quickStats.overallCpuUsage', 'summary.quickStats.overallMemoryUsage',
            'summary.config.product.version', 'summary.overallStatus', 'overallStatus', 'vm'
        ]
        hosts = collect_properties(si, [vim.HostSystem], host_props)
        
        for h in hosts:
            h_obj = h['obj']
            h_name = h.get('name', 'Unknown')
            h_state = str(h.get('runtime.connectionState', 'disconnected'))
            in_maintenance = h.get('runtime.inMaintenanceMode', False)
            
            # Identify parent cluster
            parent_cluster_obj = host_to_cluster.get(h_obj)
            c_name = cluster_data_map[parent_cluster_obj]["name"] if parent_cluster_obj else "-"
            
            if parent_cluster_obj:
                cluster_data_map[parent_cluster_obj]["total_hosts"] += 1
                if in_maintenance:
                    cluster_data_map[parent_cluster_obj]["maint_hosts"] += 1
                    
            cpu_hz = h.get('summary.hardware.cpuMhz', 0)
            cpu_ghz = round(cpu_hz / 1000, 2)
            num_vms = len(h.get('vm', []))
            
            if parent_cluster_obj:
                cluster_data_map[parent_cluster_obj]["total_vms"] += num_vms
            
            data["host_list"].append({
                "name": h_name,
                "cluster_name": c_name,
                "state": h_state,
                "in_maintenance": in_maintenance,
                "version": h.get('summary.config.product.version', 'N/A'),
                "cpu_ghz": cpu_ghz,
                "num_vms": num_vms,
                "hw_status": str(h.get('summary.overallStatus', 'unknown')),
                "overall_status": str(h.get('overallStatus', 'gray')),
                "ssh_running": False,
                "ntp_running": False
            })
            
            if h_state == "connected":
                cpu_cores = h.get('summary.hardware.numCpuCores', 0)
                used_cpu = h.get('summary.quickStats.overallCpuUsage') or 0
                mem_bytes = h.get('summary.hardware.memorySize', 0)
                used_mem = h.get('summary.quickStats.overallMemoryUsage') or 0
                
                if parent_cluster_obj:
                    cluster_data_map[parent_cluster_obj]["cpu_mhz"] += (cpu_cores * cpu_hz)
                    cluster_data_map[parent_cluster_obj]["used_cpu"] += used_cpu
                    cluster_data_map[parent_cluster_obj]["mem_bytes"] += mem_bytes
                    cluster_data_map[parent_cluster_obj]["used_mem"] += used_mem
        
        # Le build de data["clusters"] a été déplacé à la fin pour intégrer les stats Datastore

        # --- 3. VMs ---
        vm_props = ['name', 'runtime.powerState']
        vms = collect_properties(si, [vim.VirtualMachine], vm_props)
        
        data["vms"]["total"] = len(vms)
        for vm in vms:
            state_val = vm.get('runtime.powerState')
            state_str = "UNKNOWN"
            if state_val == vim.VirtualMachine.PowerState.poweredOn:
                data["vms"]["on"] += 1
                state_str = "ON"
            elif state_val == vim.VirtualMachine.PowerState.poweredOff:
                data["vms"]["off"] += 1
                state_str = "OFF"
            else:
                data["vms"]["suspend"] += 1
                state_str = "SUSPEND"
                
            data["vm_list"].append({
                "name": vm.get('name', 'Unknown'),
                "state": state_str
            })

        # --- 4. DATASTORES ---
        ds_props = ['name', 'summary.capacity', 'summary.freeSpace']
        datastores = collect_properties(si, [vim.Datastore], ds_props)
        
        ds_metrics = {}
        for ds in datastores:
            ds_obj = ds['obj']
            cap_bytes = ds.get('summary.capacity', 0)
            free_bytes = ds.get('summary.freeSpace', 0)
            ds_metrics[ds_obj] = {'cap': cap_bytes, 'free': free_bytes}
            
            if cap_bytes > 0:
                cap_gb = cap_bytes / (1024**3)
                free_gb = free_bytes / (1024**3)
                usage_pct = round(((cap_bytes - free_bytes) / cap_bytes * 100), 1)

                data["datastores"].append({
                    "name": ds.get('name', 'Unknown'),
                    "capacity_gb": round(cap_gb, 2),
                    "free_gb": round(free_gb, 2),
                    "usage_pct": usage_pct
                })

        # --- Build Clusters output array ---
        for c_obj, c_stats in cluster_data_map.items():
            for ds_moref in c_stats["ds_list"]:
                if ds_moref in ds_metrics:
                    c_stats["storage_cap_bytes"] += ds_metrics[ds_moref]["cap"]
                    c_stats["storage_free_bytes"] += ds_metrics[ds_moref]["free"]
                    
            cpu_pct = round((c_stats["used_cpu"] / c_stats["cpu_mhz"] * 100), 1) if c_stats["cpu_mhz"] > 0 else 0
            mem_pct = round(((c_stats["used_mem"] / 1024) / (c_stats["mem_bytes"] / (1024**3)) * 100), 1) if c_stats["mem_bytes"] > 0 else 0
            
            storage_used_bytes = c_stats["storage_cap_bytes"] - c_stats["storage_free_bytes"]
            storage_pct = round((storage_used_bytes / c_stats["storage_cap_bytes"] * 100), 1) if c_stats["storage_cap_bytes"] > 0 else 0
            
            data["clusters"].append({
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

    except Exception as e:
        data["status"] = "error"
        data["error_msg"] = str(e)

    return data