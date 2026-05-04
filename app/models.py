from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class CapacitySnapshot(db.Model):
    __tablename__ = 'capacity_snapshots'
    
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    device_type = db.Column(db.String(50), index=True)  # 'vmware', 'storage'
    device_name = db.Column(db.String(100), index=True)
    device_ip = db.Column(db.String(50))
    metric_name = db.Column(db.String(50))  # 'cpu_usage', 'mem_usage', 'storage_used_pct'
    value = db.Column(db.Float)

    def to_dict(self):
        return {
            "timestamp": self.timestamp.isoformat(),
            "device_type": self.device_type,
            "device_name": self.device_name,
            "metric_name": self.metric_name,
            "value": self.value
        }
