from flask import Blueprint, jsonify
from sqlalchemy import func
from datetime import datetime, timedelta
from app.models import db, CapacitySnapshot

capacity_bp = Blueprint('capacity', __name__)

@capacity_bp.route('/api/capacity/report')
def get_capacity_report():
    """Calcule les deltas W2W et MoM pour tous les équipements."""
    
    latest_snap = CapacitySnapshot.query.order_by(CapacitySnapshot.timestamp.desc()).first()
    latest_timestamp = latest_snap.timestamp.isoformat() if latest_snap else None

    def get_latest_value(name, metric):
        res = CapacitySnapshot.query.filter_by(device_name=name, metric_name=metric)\
            .order_by(CapacitySnapshot.timestamp.desc()).first()
        return res.value if res else None

    def get_value_around(name, metric, days_ago):
        target_date = datetime.utcnow() - timedelta(days=days_ago)
        res = CapacitySnapshot.query.filter_by(device_name=name, metric_name=metric)\
            .filter(CapacitySnapshot.timestamp <= target_date)\
            .order_by(CapacitySnapshot.timestamp.desc()).first()
        return res.value if res else None

    # Lister tous les équipements uniques
    devices = db.session.query(CapacitySnapshot.device_name, CapacitySnapshot.device_type)\
        .distinct().all()
    
    report = []
    for d_name, d_type in devices:
        # Métriques suivies
        metrics = ['cpu_usage', 'ram_usage', 'storage_usage'] if d_type == 'vmware' \
                  else ['storage_used_pct', 'subscription_pct', 'effective_used_pct']
        
        for m in metrics:
            curr = get_latest_value(d_name, m)
            if curr is None: continue

            w2w_old = get_value_around(d_name, m, 7)
            mom_old = get_value_around(d_name, m, 30)
            
            w2w_delta = (curr - w2w_old) if (w2w_old is not None) else None
            mom_delta = (curr - mom_old) if (mom_old is not None) else None
            
            report.append({
                "device_name": d_name,
                "device_type": d_type,
                "metric": m,
                "current": round(curr, 2),
                "w2w_delta": round(w2w_delta, 2) if w2w_delta is not None else None,
                "mom_delta": round(mom_delta, 2) if mom_delta is not None else None
            })
            
    return jsonify({
        "timestamp": latest_timestamp,
        "report": report
    })
