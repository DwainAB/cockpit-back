# Cockpit — API

API Node.js du cockpit : dossiers de sites, agents IA (webdesign, développeur), mise en ligne GitHub → Vercel. Données en mémoire, persistées en JSON (`data/`), REST + événements SSE.

## Démarrage

```bash
npm install
cp .env.example .env   # puis renseigner les clés
npm run dev            # http://localhost:4000/api
```

## Production

```bash
npm run build && npm start
```

`src/core/` contient les types et la logique métier. Une copie existe dans le dépôt du frontend : toute modification doit être reportée des deux côtés.
