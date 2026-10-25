# Cockpit — API

API Node.js du cockpit : dossiers de sites, agents IA (webdesign, développeur), mise en ligne GitHub → Vercel. Données dans la base PostgreSQL du cockpit (`COCKPIT_DATABASE_URL`) ; restaurants lus dans la base Yumco (`YUMCO_DATABASE_URL`, lecture seule). REST + événements SSE. Les fichiers (maquettes, sites générés, images) restent dans `data/`.

## Démarrage

```bash
npm install
createdb cockpit       # base locale du cockpit (tables créées au démarrage)
cp .env.example .env   # puis renseigner les clés
npm run dev            # http://localhost:4000/api
```

## Production

```bash
npm run build && npm start
```

`src/core/` contient les types et la logique métier. Une copie existe dans le dépôt du frontend : toute modification doit être reportée des deux côtés.
