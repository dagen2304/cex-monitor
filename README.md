# NOC INFRA Unified Dashboard

![Version](https://img.shields.io/badge/version-1.0.0-orange)
![Python](https://img.shields.io/badge/python-3.8%2B-blue)
![Flask](https://img.shields.io/badge/framework-Flask-lightgrey)

Une console de supervision unifiée pour les infrastructures VMware vSphere et le stockage SAN/NAS (Unity, Dorado, PowerStore, DataDomain, Scality). Ce dashboard permet un monitoring en temps réel, une analyse capacitaire précise et une gestion centralisée du parc d'équipements.

## 🚀 Fonctionnalités Clés

### 1. Supervision VMware vSphere
*   **Multi-vCenter :** Vue consolidée de tous vos vCenters.
*   **Métriques en Temps Réel :** État des hôtes ESXi, usage CPU/RAM global et par cluster.
*   **Inventaire Détaillé :** Liste des VMs (ON/OFF), état des clusters et datastores avec alertes de saturation.
*   **Flux SSE :** Mise à jour automatique des données sans rafraîchir la page.

### 2. Monitoring Stockage SAN/NAS
*   **Collecteurs Multi-Constructeurs :** Support natif pour Dell Unity, Huawei Dorado, Dell PowerStore, DataDomain et Scality Ring.
*   **Heatmap de Santé :** Visualisation rapide de l'état de santé de toutes les baies.
*   **Performance & Capacité :** IOPS, bande passante, latence et taux d'occupation des pools.

### 3. Capacité & Tendances (Tableau de Bord Décisionnel)
*   **Indicateurs avec Cibles :** Tableau comparatif des usages réels vs cibles de saturation (ex: CPU <= 50%, Stockage <= 80%).
*   **Analyse Hebdomadaire :** Suivi dynamique par numéro de semaine (W2W).
*   **Matching Intelligent :** Liaison automatique entre les équipements de l'inventaire et les lignes du rapport.
*   **Capture Manuelle :** Bouton pour déclencher une collecte immédiate des métriques.
*   **Exports Haute Fidélité :** Exportation des données en formats **XLS**, **CSV** et capture d'image **PNG**.

### 4. Gestion de l'Inventaire (CRUD)
*   **Interface Dédiée :** Ajout, modification et suppression d'équipements directement depuis l'UI.
*   **Base de Données SQLite :** Stockage sécurisé des configurations et des identifiants (mots de passe chiffrés).
*   **Migration Automatique :** Script inclus pour migrer les anciennes configurations `.env` vers la base de données.

## 🛠️ Installation & Déploiement

### Prérequis
*   Python 3.8 ou supérieur
*   Accès réseau aux APIs vCenter et aux baies de stockage

### Procédure d'installation

1. **Cloner le dépôt :**
   ```bash
   git clone https://github.com/dagen2304/cex-monitor.git
   cd cex-monitor
   ```

2. **Créer un environnement virtuel :**
   ```bash
   python -m venv venv
   source venv/bin/activate  # Sur Windows: venv\Scripts\activate
   ```

3. **Installer les dépendances :**
   ```bash
   pip install -r requirements.txt
   ```

4. **Initialiser la base de données :**
   Si vous avez un fichier `.env` existant, lancez la migration :
   ```bash
   python migrate_env_to_db.py
   ```

### Lancement de l'application

Pour lancer le serveur de développement :
```bash
python run.py
```
L'interface sera accessible sur **http://localhost:5000**.

## ⚙️ Configuration

*   **Identifiants :** Ajoutez vos équipements via l'onglet **Inventaire** de l'interface utilisateur.
*   **Chiffrement :** Les mots de passe sont chiffrés en base de données via une clé Fernet (générée automatiquement au premier lancement).
*   **Logs :** Consultez le fichier `cex-monitor.log` pour le diagnostic des collectes.

## 📦 Structure du Projet

*   `/app` : Logique backend (API, Modèles, Services de collecte).
*   `/static` : Assets frontend (CSS, JS, Images).
*   `/templates` : Vues HTML (Jinja2).
*   `/instance` : Base de données SQLite locale.
*   `run.py` : Point d'entrée de l'application.

---
Développé pour l'équipe **NOC INFRA**.
