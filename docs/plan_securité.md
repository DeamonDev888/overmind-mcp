# 🛡️ PLAN SÉCURITÉ OVERMIND — Guérison Complète

> **Date** : 28 Mai 2026  
> **Auteur** : Sniper Analyste Financier (via audit Discord)  
> **Relecteur** : sley_73350 (validation en cours)  
> **Version** : 1.0 — Brouillon pour validation

---

## 🔍 ÉTAT DES LIEUX — Diagnostic Critique

### Surface d'attaque actuelle

```
╔═══════════════════════════════════════════════════════════════════════════╗
║ TRANSPORT    │ PROTOCOLE    │ POINT D'ENTRÉE       │ AUTH? │ PORT   ║
╠═══════════════════════════════════════════════════════════════════════════╣
║ STDIO        │ JSON-RPC 2.0 │ stdin → stdout      │ ❌    │ N/A    ║
║ HTTP Stream  │ JSON-RPC 2.0 │ POST /mcp          │ ❌    │ 3099   ║
║ HTTP Stream  │ SSE          │ POST /mcp (stream) │ ❌    │ 3099   ║
║ HTTP Stream  │ REST         │ GET /health        │ ❌    │ 3099   ║
║ HTTPS (SSL)  │ JSON-RPC 2.0 │ POST /mcp          │ ❌    │ 3099   ║
║ HTTPS (SSL)  │ SSE          │ POST /mcp (stream) │ ❌    │ 3099   ║
╚═══════════════════════════════════════════════════════════════════════════╝

🔐 CONSTAT : TOUS les endpoints sont OUVERTS — 0 authentification côté serveur
```

### 14 Outils MCP exposés sans protection

```
#  │ TOOL                    │ RISQUE
───┼─────────────────────────┼──────────
01 │ run_agent               │ 🔴 CRITIQUE
02 │ run_agents_parallel     │ 🔴 CRITIQUE
03 │ create_agent            │ 🟠 ÉLEVÉ
04 │ delete_agent            │ 🟠 ÉLEVÉ
05 │ update_agent_config     │ 🔴 CRITIQUE
06 │ list_agents             │ 🟡 MOYEN
07 │ get_agent_configs       │ 🔴 CRITIQUE (fuites clés API)
08 │ create_prompt           │ 🟡 MOYEN
09 │ edit_prompt             │ 🟡 MOYEN
10 │ memory_search           │ 🟡 MOYEN
11 │ memory_store            │ 🟡 MOYEN
12 │ memory_runs             │ 🟢 FAIBLE
13 │ config_example          │ 🟢 FAIBLE
14 │ agent_control           │ 🔴 CRITIQUE (kill process)
```

### Modules bibliothèque — Couverture Bearer

```
MODULE                  │ TYPE    │ ENVOIE BEARER │ REÇOIT/VERIFY │ STATUS
────────────────────────┼─────────┼───────────────┼───────────────┼───────
overmind-client.ts      │ Client  │ ✅ OUI        │ N/A           │ ✅ OK
cli.ts (serveur)        │ Serveur │ N/A           │ ❌ NON        │ 🔴 GAP
server.ts (FastMCP)     │ Serveur │ N/A           │ ❌ NON        │ 🔴 GAP
run_agent.ts            │ Tool    │ N/A           │ ❌ NON        │ 🔴 GAP
run_agents_parallel.ts  │ Tool    │ N/A           │ ❌ NON        │ 🔴 GAP
create_agent.ts         │ Tool    │ N/A           │ ❌ NON        │ 🔴 GAP
manage_agents.ts        │ Tool    │ N/A           │ ❌ NON        │ 🔴 GAP
memory_store.ts         │ Tool    │ N/A           │ ❌ NON        │ 🔴 GAP
memory_search.ts        │ Tool    │ N/A           │ ❌ NON        │ 🔴 GAP
agent_control.ts        │ Tool    │ N/A           │ ❌ NON        │ 🔴 GAP
config.ts               │ Config  │ N/A           │ ❌ NON        │ 🟡
processRegistry.ts      │ Runtime │ N/A           │ ❌ NON        │ 🔴 GAP
```

---

## 🏗️ ARCHITECTURE CIBLE — Après Guérison

```
                    🔐 MIDDLEWARE AUTH ACTIF 🔐
┌──────────┐    Bearer     ┌──────────────┐    ┌────────────┐
│  Client   │ ──────────▶  │  FastMCP     │───▶│  14 Tools  │
│  (TS/JS)  │  Header ✓   │  v4.0.1      │    │  MCP       │
│           │              │  ✅ CHECK ✓  │    │  (protégés)│
└──────────┘              └──────┬───────┘    └────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │  Transports sécurisés    │
                    ├─────────────────────────┤
                    │ stdio  (pipe local)      │
                    │ httpStream (port 3099)   │
                    │   endpoint: /mcp         │
                    │   ✅ Bearer: REQUIRED    │
                    │   stateless: true        │
                    │   SSL: ACTIF             │
                    └─────────────────────────┘
```

---

## 📋 PLAN D'IMPLÉMENTATION — 5 Phases

### PHASE 1 — Middleware Serveur Bearer (PRIORITÉ MAX)

**Objectif** : Bloquer tout accès non authentifié sur HTTP/RPC

**Fichier cible** : `src/cli.ts` + `src/server.ts`

**Tâches** :
- [ ] Créer `src/lib/bearerMiddleware.ts`
  - Fonction `verifyBearer(request): boolean`
  - Lecture `OVERMIND_AUTH` depuis `.env`
  - Comparaison via `crypto.timingSafeEqual()` (anti timing attack)
  - Retourner 401 + message JSON si token absent/invalide
- [ ] Injecter le middleware dans FastMCP httpStream
  - Hook AVANT `server.start()`
  - Exempter UNIQUEMENT `GET /health` (monitoring)
  - Bloquer tout le reste si token absent
- [ ] Logger chaque accès (audit trail)
  - IP source, timestamp, tool appelé, résultat auth

**Code de référence** :
```typescript
// src/lib/bearerMiddleware.ts
import crypto from 'crypto';

export function verifyBearer(authHeader: string | undefined): boolean {
  const expected = process.env.OVERMIND_AUTH;
  if (!expected) {
    console.warn('[AUTH] ⚠️ OVERMIND_AUTH non défini — accès refusé par défaut');
    return false;
  }
  if (!authHeader?.startsWith('Bearer ')) return false;
  
  const token = authHeader.slice(7);
  const expectedBuf = Buffer.from(expected);
  const tokenBuf = Buffer.from(token);
  
  if (tokenBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(tokenBuf, expectedBuf);
}
```

**Validation** :
- [ ] Tester sans token → 401
- [ ] Tester avec mauvais token → 401
- [ ] Tester avec bon token → 200
- [ ] GET /health sans token → 200 (exempté)

---

### PHASE 2 — Intégration dans tous les modules de la bibliothèque

**Objectif** : Chaque module serveur vérifie le Bearer

**Fichiers cibles** :
- `src/cli.ts` (serveur principal)
- `src/server.ts` (FastMCP)
- Chaque tool MCP (run_agent, memory_store, etc.)

**Tâches** :
- [ ] Importer `verifyBearer` dans chaque point d'entrée serveur
- [ ] Ajouter un wrapper `withAuth(toolHandler)` qui :
  1. Extrait le header Authorization du contexte MCP
  2. Vérifie via `verifyBearer()`
  3. Si échec → retourne erreur MCP avec code d'auth
  4. Si succès → exécute le tool normalement
- [ ] Valider que les 14 tools sont couverts

**Code de référence** :
```typescript
// src/lib/withAuth.ts
import { verifyBearer } from './bearerMiddleware';

export function withAuth(handler: Function) {
  return async (args: any, context: any) => {
    const authHeader = context?.request?.headers?.authorization;
    if (!verifyBearer(authHeader)) {
      throw new Error('[AUTH] ❌ Accès refusé — Bearer token invalide');
    }
    return handler(args, context);
  };
}
```

---

### PHASE 3 — Propagation aux configs agents (.mcp.json)

**Objectif** : Chaque agent injecte le Bearer dans ses appels

**Tâches** :
- [ ] Vérifier que `overmind-client.ts` envoie bien le Bearer ✅ (déjà fait)
- [ ] Mettre à jour les templates `.mcp.json` des agents
  - Ajouter `Authorization: Bearer ${OVERMIND_AUTH}` dans les headers
- [ ] Scripts externes → utiliser `OVERMIND_AUTH` depuis `.env`
- [ ] Documenter la variable dans le README Overmind

**Exemple .mcp.json** :
```json
{
  "mcpServers": {
    "overmind": {
      "url": "http://localhost:3099/mcp",
      "headers": {
        "Authorization": "Bearer ${OVERMIND_AUTH}"
      }
    }
  }
}
```

---

### PHASE 4 — SSL/TLS + Durcissement Réseau

**Objectif** : Chiffrer les communications + réduire la surface

**Tâches** :
- [ ] Activer SSL sur le port 3099 (HTTPS)
  - Générer certificat auto-signé ou Let's Encrypt
  - Configurer dans FastMCP httpStream
- [ ] Restreindre le bind à `localhost` uniquement (sauf besoin externe)
- [ ] Ajouter rate-limiting sur les endpoints
  - Max 100 req/min par IP
  - Ban temporaire après 5 échecs d'auth consécutifs
- [ ] CORS restrictif (si besoin)
- [ ] Firewall : bloquer le port 3099 à l'extérieur sauf reverse proxy

---

### PHASE 5 — Audit Trail & Monitoring

**Objectif** : Traçabilité complète des accès

**Tâches** :
- [ ] Logger chaque requête MCP :
  - Timestamp ISO 8601
  - IP source
  - Tool appelé
  - Résultat auth (success/fail)
  - Agent demandeur
- [ ] Stocker les logs dans PostgreSQL (table `audit_log`)
  ```sql
  CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    ip VARCHAR(45),
    tool VARCHAR(100),
    agent VARCHAR(100),
    auth_result BOOLEAN,
    details JSONB
  );
  ```
- [ ] Alertes Discord automatiques :
  - 3 échecs d'auth consécutifs → alerte embed
  - Tool critique appelé → notification
- [ ] Dashboard simple (endpoint `/audit/stats`)

---

## 🧪 PLAN DE TEST — Validation par Phase

### Tests Phase 1 (Middleware)
```
TEST │ DESCRIPTION                    │ RÉSULTAT ATTENDU
─────┼────────────────────────────────┼──────────────────
T1.1 │ curl POST /mcp sans header     │ 401 Unauthorized
T1.2 │ curl POST /mcp mauvais token   │ 401 Unauthorized
T1.3 │ curl POST /mcp bon token       │ 200 OK
T1.4 │ curl GET /health sans token    │ 200 OK (exempté)
T1.5 │ curl GET /health mauvais token │ 200 OK (exempté)
T1.6 │ Token vide                     │ 401 Unauthorized
T1.7 │ OVERMIND_AUTH non défini       │ 500 / 403
```

### Tests Phase 2 (Couverture modules)
```
TEST │ DESCRIPTION                           │ RÉSULTAT ATTENDU
─────┼───────────────────────────────────────┼──────────────────
T2.1 │ Appeler run_agent sans Bearer         │ Erreur MCP auth
T2.2 │ Appeler run_agent avec Bearer         │ Exécution normale
T2.3 │ Appeler memory_search sans Bearer     │ Erreur MCP auth
T2.4 │ Appeler agent_control sans Bearer     │ Erreur MCP auth
T2.5 │ Vérifier les 14 tools couverts        │ 14/14 ✅
```

### Tests Phase 3 (Propagation)
```
TEST │ DESCRIPTION                              │ RÉSULTAT ATTENDU
─────┼──────────────────────────────────────────┼──────────────────
T3.1 │ Agent Claude appelle overmind sans Bearer │ Connexion refusée
T3.2 │ Agent Kilo appelle overmind avec Bearer   │ Connexion OK
T3.3 │ Script externe sans OVERMIND_AUTH         │ Échec auth
T3.4 │ Script externe avec OVERMIND_AUTH         │ Succès
```

### Tests Phase 4 (SSL + Durcissement)
```
TEST │ DESCRIPTION                              │ RÉSULTAT ATTENDU
─────┼──────────────────────────────────────────┼──────────────────
T4.1 │ Accès HTTP (non SSL)                     │ Connexion refusée
T4.2 │ Accès HTTPS avec cert valide             │ 200 OK
T4.3 │ Rate limit : 100+ req/min                │ 429 Too Many
T4.4 │ 5 échecs auth consécutifs                │ Ban temporaire
T4.5 │ Bind localhost uniquement                 │ Pas d'accès externe
```

### Tests Phase 5 (Audit)
```
TEST │ DESCRIPTION                              │ RÉSULTAT ATTENDU
─────┼──────────────────────────────────────────┼──────────────────
T5.1 │ Appel tool → vérifier log PostgreSQL     │ Entrée présente
T5.2 │ Échec auth → vérifier log               │ Entrée avec auth_result=false
T5.3 │ 3 échecs consécutifs → alerte Discord   │ Embed envoyé
T5.4 │ GET /audit/stats                         │ JSON statistiques
```

---

## 📊 PRIORISATION & EFFORT

```
PHASE │ PRIORITÉ    │ EFFORT    │ IMPACT     │ DÉPENDANCE
──────┼─────────────┼───────────┼────────────┼────────────
  1   │ 🔴 CRITIQUE │ 🟡 Moyen  │ 🟢 MAX     │ Aucune
  2   │ 🟠 ÉLEVÉ    │ 🟡 Moyen  │ 🟢 ÉLEVÉ   │ Phase 1
  3   │ 🟡 MOYEN    │ 🟢 Faible │ 🟡 MOYEN   │ Phase 1
  4   │ 🟡 MOYEN    │ 🔴 ÉLEVÉ  │ 🟢 ÉLEVÉ   │ Phase 1
  5   │ 🟢 FAIBLE   │ 🟡 Moyen  │ 🟡 MOYEN   │ Phase 1+2
```

**Recommandation** : Phase 1 immédiate → Phase 2 le même jour → Phase 3 le lendemain → Phase 4-5 dans la semaine

---

## 🔑 LIVRABLES

1. `src/lib/bearerMiddleware.ts` — Middleware de vérification Bearer
2. `src/lib/withAuth.ts` — Wrapper pour les handlers MCP
3. `.env` — Ajout de `OVERMIND_AUTH=<token_sécurisé>`
4. `audit_log` table PostgreSQL — Traçabilité
5. Documentation mise à jour — README + SECURITY.md

---

## ⚠️ POINTS D'ATTENTION (Sley à vérifier)

- Le Bearer middleware doit-il être dans `cli.ts` OU dans un hook FastMCP ?
- FastMCP v4.0.1 supporte-t-il un middleware natif ou faut-il un workaround Express ?
- STDIO doit-il aussi être protégé ou est-il trusted par design (local pipe) ?
- Le token doit-il être rotatif ou statique ?
- Faut-il un système de scopes (admin vs lecture seule) ?

---

*📝 Document en attente de validation par sley_73350*
