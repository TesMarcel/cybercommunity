# Déploiement, sauvegarde et restauration

Ce guide décrit une installation sur un serveur Linux (VPS) avec **Node.js**, **PostgreSQL**, **Nginx** en proxy et un certificat **HTTPS** Let's Encrypt. Le serveur Node fournit à la fois l'API et le frontend : un seul service à faire tourner.

> Cette procédure n'a pas encore été déroulée sur un vrai serveur : les commandes sont standard, mais vérifiez chaque étape et adaptez les chemins.

## 1. Prérequis

- Linux (Debian/Ubuntu ou Arch), accès `sudo`
- Node.js 18 ou plus récent, PostgreSQL 14 ou plus récent, Nginx, Certbot
- Un nom de domaine pointant vers le serveur (ex. `cyber.example.org`)

## 2. Base de données

```bash
sudo -iu postgres createuser --pwprompt cybercom      # choisir un mot de passe fort
sudo -iu postgres createdb --owner=cybercom cyber_community
```

PostgreSQL n'écoute que sur `localhost` par défaut : ne l'ouvrez pas sur Internet.

## 3. Application

```bash
sudo useradd --system --create-home --home-dir /opt/cybercommunity cybercom
sudo -iu cybercom git clone https://github.com/TesMarcel/cybercommunity.git /opt/cybercommunity/app
cd /opt/cybercommunity/app/backend
sudo -iu cybercom bash -c 'cd /opt/cybercommunity/app/backend && npm ci --omit=dev'
```

`--omit=dev` n'installe pas les outils de test (puppeteer-core).

Créer `backend/.env` (lisible uniquement par le compte du service) :

```ini
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://cybercom:MOT_DE_PASSE@localhost:5432/cyber_community
JWT_SECRET=<résultat de : node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
TRUST_PROXY=1
```

```bash
sudo chown cybercom: /opt/cybercommunity/app/backend/.env
sudo chmod 600 /opt/cybercommunity/app/backend/.env
sudo -iu cybercom bash -c 'cd /opt/cybercommunity/app/backend && npm run db:init'
```

- `NODE_ENV=production` active l'en-tête HSTS (HTTPS obligatoire) : à n'utiliser qu'une fois le HTTPS en place.
- `TRUST_PROXY=1` : indispensable derrière Nginx, sinon la limite de tentatives voit la même adresse IP pour tout le monde.
- `CORS_ORIGIN` reste vide : le frontend est servi par le même serveur.

## 4. Service systemd

`/etc/systemd/system/cybercommunity.service` :

```ini
[Unit]
Description=Cyber Community
After=network.target postgresql.service

[Service]
User=cybercom
WorkingDirectory=/opt/cybercommunity/app/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cybercommunity
journalctl -u cybercommunity -f        # journal (une ligne par requête, sans données sensibles)
```

## 5. Nginx et HTTPS

`/etc/nginx/sites-available/cybercommunity` (sur Arch : à inclure depuis `nginx.conf`) :

```nginx
server {
    listen 80;
    server_name cyber.example.org;

    # Pièces jointes jusqu'à 10 Mo (Nginx limite à 1 Mo par défaut)
    client_max_body_size 11m;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/cybercommunity /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d cyber.example.org      # HTTPS + redirection automatique
```

Le port 5000 ne doit pas être accessible depuis Internet (pare-feu : ouvrir seulement 22, 80 et 443).

## 6. Premier administrateur

Créer son compte depuis le site, puis :

```bash
sudo -iu cybercom bash -c 'cd /opt/cybercommunity/app/backend && npm run make-admin -- VOTRE_NOM'
```

## 7. Vérifications après déploiement

```bash
curl -s https://cyber.example.org/api/health                 # {"status":"online",...}
curl -sI https://cyber.example.org/ | grep -iE 'strict-transport|content-security|x-frame'
curl -sI http://cyber.example.org/ | head -1                 # redirection vers https
curl -s -o /dev/null -w '%{http_code}\n' https://cyber.example.org/uploads/files/x   # 404 : pièces jointes non publiques
```

Puis dans le navigateur : inscription, connexion, discussion, envoi d'une pièce jointe de quelques Mo dans un groupe.

## 8. Mise à jour

```bash
cd /opt/cybercommunity/app
sudo -iu cybercom bash -c 'cd /opt/cybercommunity/app/backend && npm run backup'   # toujours avant
sudo -iu cybercom git -C /opt/cybercommunity/app pull
sudo -iu cybercom bash -c 'cd /opt/cybercommunity/app/backend && npm ci --omit=dev'
sudo systemctl restart cybercommunity
```

`npm run db:init` ne crée que les tables manquantes : il ne modifie ni ne supprime les tables existantes. Une évolution du schéma (nouvelle colonne, contrainte) nécessitera un script de migration dédié, à tester sur une copie de la base.

## 9. Sauvegarde

```bash
cd backend
npm run backup
```

Crée dans `backend/backups/` (dossier ignoré par git, accès réservé au propriétaire) :

- `cybercom-<date>.dump` : la base (format compressé de `pg_dump`)
- `cybercom-<date>.uploads.tar.gz` : photos de profil et pièces jointes

Les 14 dernières sauvegardes sont conservées. Variables facultatives : `BACKUP_DIR`, `UPLOAD_DIR`.

Sauvegarde quotidienne à 3 h (`sudo crontab -u cybercom -e`) :

```cron
0 3 * * * cd /opt/cybercommunity/app/backend && bash scripts/backup.sh >> backups/backup.log 2>&1
```

**Copiez régulièrement les sauvegardes hors du serveur** (autre machine, stockage externe) : une sauvegarde sur le même disque ne protège pas d'une panne de ce disque.

`pg_dump` doit être d'une version égale ou supérieure à celle du serveur PostgreSQL.

## 10. Restauration

À faire sur une base **vide**, de préférence nouvelle, pour ne rien écraser par erreur :

```bash
sudo systemctl stop cybercommunity

sudo -iu postgres createdb --owner=cybercom cyber_community_restauree
pg_restore --no-owner -d "postgresql://cybercom:MOT_DE_PASSE@localhost:5432/cyber_community_restauree" backups/cybercom-<date>.dump

mkdir -p uploads && tar -xzf backups/cybercom-<date>.uploads.tar.gz -C uploads
```

Puis faire pointer `DATABASE_URL` vers `cyber_community_restauree` dans `.env` et redémarrer le service. Une fois le site vérifié, l'ancienne base peut être supprimée.

Procédure testée le 2026-10-26 en local (avec le compte `postgres`) : données et fichiers restaurés à l'identique.

## 11. Sécurité : ce qui est en place, ce qui reste à surveiller

En place : mots de passe bcrypt, tokens invalidés au changement de mot de passe, limites anti brute-force, requêtes SQL paramétrées, contrôle des droits sur chaque route, en-têtes de sécurité (CSP, HSTS, anti-iframe), pièces jointes privées et toujours téléchargées, contenus affichés comme texte (anti-XSS), CORS fermé.

À surveiller :

- **Le token est stocké dans le navigateur** (`localStorage`). La CSP limite fortement le risque, mais une faille XSS permettrait de le voler (validité 7 jours).
- **Pas d'analyse antivirus** des pièces jointes.
- **Pas de confirmation d'adresse email** ni de mot de passe oublié (pas de service d'envoi d'emails).
- **Limites de tentatives en mémoire** : remises à zéro à chaque redémarrage, et non partagées si plusieurs instances tournent.
- Mettre à jour régulièrement le système, Node.js et les dépendances (`npm audit`).
