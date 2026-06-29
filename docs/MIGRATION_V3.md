# Migration v3.1 — Guide de mise à jour Overmind MCP

> **Version**: 2.8.53 → 2.9.0+
> **Impact**: Changement de l'arborescence des profils Hermes
> **Rétrocompatibilité**: Oui (fallback automatique vers l'ancien layout)

---

## Ce qui change

```
AVANT (v2.8.x)                          APRÈS (v3.1)
─────────────────────────────           ─────────────────────────────
~/.hermes/profiles/<name>/              ~/.overmind/hermes/profiles/<name>/
  config.yaml                             config.yaml
  .env                                    .env
  SOUL.md                                 SOUL.md
                                          profile.yaml      ← NOUVEAU
                                          workspace.yaml    ← NOUVEAU
                                          README.md         ← NOUVEAU

.claude/sessions.json                  → bridge/agents.json
.claude/process-registry.json          → bridge/process-registry.json
```

---

## Étape 1 — Mettre à jour le package

```bash
# Sur le serveur Ubuntu (ou Windows local)
sudo npm install -g overmind-mcp@latest
```

Le postinstall crée `~/.overmind/bridge/` automatiquement.

---

## Étape 2 — Migration des profils existants

Le code v3.1 a un **fallback automatique**: si un profil n'existe pas dans
`~/.overmind/hermes/profiles/`, il le cherche dans `~/.hermes/profiles/`.
Vos agents **continuent de fonctionner** sans migration.

Pour migrer un profil vers le nouveau layout:

```bash
# Créer le nouveau répertoire
mkdir -p ~/.overmind/hermes/profiles

# Pour chaque profil existant:
cp -r ~/.hermes/profiles/sniperbot_analyst ~/.overmind/hermes/profiles/
cp -r ~/.hermes/profiles/tradingview_analyst ~/.overmind/hermes/profiles/
cp -r ~/.hermes/profiles/pdf_bon_travail ~/.overmind/hermes/profiles/

# Générer les fichiers manquants (profile.yaml, workspace.yaml, README.md)
# via le tool MCP create_agent ou manuellement:
hermes profile create <name> --description "..."  # régénère si existe déjà
```

---

## Étape 3 — Migrer les sessions (bridge)

```bash
# Déplacer l'ancien sessions.json vers le nouveau chemin
mkdir -p ~/.overmind/bridge
cp ~/.overmind/.claude/sessions.json ~/.overmind/bridge/agents.json 2>/dev/null
cp ~/.overmind/.claude/process-registry.json ~/.overmind/bridge/process-registry.json 2>/dev/null

# Ou si le workspace est le dossier source:
cp .claude/sessions.json ~/.overmind/bridge/agents.json 2>/dev/null
```

---

## Étape 4 — Redémarrer les services

```bash
# Ubuntu (systemd)
sudo systemctl restart overmind-mcp.service
sudo systemctl restart discord-llm.service
sudo systemctl restart tradingview-analyst.service

# Vérifier
systemctl is-active overmind-mcp discord-llm tradingview-analyst
```

---

## Étape 5 — Valider

```bash
# Lister les agents
overmind list_agents
# ou via MCP:
curl -s -X POST http://localhost:3099/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_agents","arguments":{}}}'

# Tester un agent
!sniper allo    # sur Discord
!trade BTCUSDT 60

# Vérifier les sessions
cat ~/.overmind/bridge/agents.json
```

---

## Rollback (en cas de problème)

```bash
# Revenir à l'ancienne version
sudo npm install -g overmind-mcp@2.8.53

# Restaurer l'ancien layout
cp ~/.overmind/bridge/agents.json ~/.overmind/.claude/sessions.json 2>/dev/null
cp ~/.overmind/bridge/process-registry.json ~/.overmind/.claude/process-registry.json 2>/dev/null

sudo systemctl restart overmind-mcp.service
```

---

## Note importante

Le fallback automatique signifie que **même si vous ne migrez rien**, vos agents
existentants continueront de fonctionner. La migration est recommandée mais
pas obligatoire immédiatement. Les nouveaux agents créés après la mise à jour
seront automatiquement placés dans le nouveau layout avec profile.yaml +
workspace.yaml + README.md.
