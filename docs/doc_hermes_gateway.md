# 📡 Documentation — Hermes Gateway

> Gateway multi-plateforme de Hermes Agent par Nous Research
> Version : 2.1+ | Dernière MAJ : 2026-05-30

---

## 1. Architecture Générale

```
┌──────────────────────────────────────────────────────────┐
│                    HERMES GATEWAY                         │
│                                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │Telegram  │  │ Discord │  │ Slack   │  │WhatsApp │    │
│  │ Adapter  │  │ Adapter │  │ Adapter │  │ Adapter │    │
│  └────┬─────┘  └────┬────┘  └────┬────┘  └────┬────┘    │
│       │              │            │              │         │
│  ┌────▼──────────────▼────────────▼──────────────▼────┐  │
│  │           SESSION ROUTER (state.db)                 │  │
│  │  • Route messages to agent sessions                 │  │
│  │  • Channel → Session mapping                        │  │
│  │  • Topic/Thread support                             │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────▼────────────────────────────┐  │
│  │           AGENT LOOP (run_agent.py)                 │  │
│  │  • System prompt construction                      │  │
│  │  • LLM API calls (OpenAI format)                   │  │
│  │  • Tool dispatch (MCP + native)                     │  │
│  │  • Context compression                             │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────▼────────────────────────────┐  │
│  │           TOOL LAYER                                │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐           │  │
│  │  │ Terminal  │ │ File I/O │ │ Browser  │           │  │
│  │  └──────────┘ └──────────┘ └──────────┘           │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐           │  │
│  │  │ Web/HTTP │ │ Cron     │ │ Delegat. │           │  │
│  │  └──────────┘ └──────────┘ └──────────┘           │  │
│  │  ┌──────────────────────────────────────┐         │  │
│  │  │ MCP Servers (HTTP/stdio)              │         │  │
│  │  │ memory, discord, postgres, x, etc.    │         │  │
│  │  └──────────────────────────────────────┘         │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  SERVICES ANNEXES                                  │  │
│  │  • Cron Scheduler (jobs.py + scheduler.py)         │  │
│  │  • Curator (skill lifecycle)                       │  │
│  │  • Kanban (multi-agent work queue)                 │  │
│  │  • TTS / STT                                       │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Composants clés

| Composant | Fichier | Rôle |
|-----------|---------|------|
| Gateway runner | `gateway/run.py` | Boucle principale, dispatch messages |
| Platform adapters | `gateway/platforms/*.py` | Un adapter par plateforme |
| Session router | `hermes_state.py` | SQLite state.db, routing |
| Agent loop | `run_agent.py` | Conversation LLM + tools |
| Tool dispatch | `model_tools.py` | Appels outils natifs + MCP |
| Cron scheduler | `cron/scheduler.py` | Jobs planifiés |
| Curator | `skills/curator.py` | Maintenance skills |

---

## 2. Plateformes Supportées

| Plateforme | Adapter | Auth requise | Features |
|------------|---------|-------------|----------|
| **Telegram** | `telegram.py` | Bot Token | Topics, DMs, groupes, inline |
| **Discord** | `discord.py` | Bot Token | Embeds, threads, réactions, boutons |
| **Slack** | `slack.py` | Bot Token + Signing Secret | Channels, DMs, threads |
| **WhatsApp** | `whatsapp.py` | WhatsApp Business API | Messages, médias |
| **Signal** | `signal.py` | signal-cli | Messages, groupes |
| **Email** | `email.py` | IMAP/SMTP | Envoi/réception, pièces jointes |
| **SMS** | `sms.py` | Twilio / Vonage | Envoi/réception SMS |
| **Matrix** | `matrix.py` | Homeserver + Token | Rooms, DMs |
| **Mattermost** | `mattermost.py` | Bot Token | Channels, DMs |
| **Home Assistant** | `homeassistant.py` | HA Webhook | Intentions, contrôle |
| **DingTalk** | `dingtalk.py` | App Key/Secret | Messages, groupes |
| **Feishu (Lark)** | `feishu.py` | App ID/Secret | Messages, docs |
| **WeCom** | `wecom.py` | Corp ID + Secret | Messages |
| **BlueBubbles** | `bluebubbles.py` | BB Server URL | iMessage |
| **Weixin (WeChat)** | `weixin.py` | App ID/Secret | Messages |
| **API Server** | `api_server.py` | Clé API custom | REST endpoint |
| **Webhooks** | `webhook.py` | Route config | POST entrants |
| **Open WebUI** | via API Server | Clé API | Interface web |

### Configuration plateforme

```bash
# Setup interactif
hermes gateway setup

# Ou édition manuelle
hermes config edit
```

Exemple config Discord :
```yaml
discord:
  bot_token: ${DISCORD_BOT_TOKEN}
  enabled: true
  prefix: "!"
  allowed_channels: []  # vide = tous
```

---

## 3. Commandes CLI Gateway

```bash
# Démarrer le gateway (foreground)
hermes gateway run

# Installer comme service système
hermes gateway install

# Contrôle du service
hermes gateway start
hermes gateway stop
hermes gateway restart

# État du gateway
hermes gateway status

# Configuration initiale
hermes gateway setup
```

### Options avancées

```bash
# Lancer avec un profil spécifique
hermes gateway run --profile sniper

# Mode verbose (debug)
hermes gateway run --verbose

# Port custom pour API server
hermes gateway run --port 8080
```

---

## 4. Configuration (config.yaml)

### Sections pertinentes pour le gateway

```yaml
# === MODÈLE ===
model:
  default: glm-5.2
  provider: z-ai
  context_length: 128000

# === AGENT ===
agent:
  max_turns: 90
  tool_use_enforcement: true  # Oblige à utiliser les outils

# === TERMINAL ===
terminal:
  backend: local        # local, docker, ssh
  timeout: 180

# === COMPRESSION ===
compression:
  enabled: true
  threshold: 0.50       # Déclenche à 50% du context
  target_ratio: 0.20    # Cible 20% du context

# === TTS ===
tts:
  provider: elevenlabs
  voice: charlie
  voice_id: IKne3meq5aSn9XLyUdCD
  model: eleven_multilingual_v2

# === STT ===
stt:
  enabled: true
  provider: local       # local, groq, openai, mistral
  local:
    model: base

# === MÉMOIRE ===
memory:
  memory_enabled: true
  user_profile_enabled: true
  provider: built-in    # built-in, honcho, mem0

# === SÉCURITÉ ===
security:
  redact_secrets: false
  tirith_enabled: true
  website_blocklist: []

# === APPROBATIONS ===
approvals:
  mode: manual          # manual, smart, off

# === MCP ===
mcp_servers:
  memory-server:
    url: "http://localhost:3099/mcp"
  discord-server:
    url: "http://localhost:3141/mcp"

# === DÉLÉGATION ===
delegation:
  max_concurrent_children: 3
  max_spawn_depth: 1

# === CRON ===
# Géré via l'outil cronjob, pas de config yaml directe

# === CANVAS ===
display:
  skin: default
  tool_progress: true
  show_reasoning: false
  show_cost: false
```

---

## 5. Slash Commands (Mode Gateway)

### Contrôle de session
```
/new (/reset)        Nouvelle session
/clear               Effacer + nouvelle session
/retry               Renvoyer dernier message
/undo                Annuler dernier échange
/title [name]        Nommer la session
/compress            Compression manuelle du contexte
/stop                Tuer processus en arrière-plan
/rollback [N]        Restaurer checkpoint filesystem
```

### Configuration
```
/config              Afficher config
/model [name]        Changer de modèle
/personality [name]  Changer personnalité
/reasoning [level]   Niveau de raisonnement (none→xhigh)
/verbose             Cycle verbose
/voice [on|off|tts]  Mode vocal
/yolo                Bypass approbations
/status              Info session
```

### Outils & Skills
```
/tools               Gérer outils (CLI)
/skills              Installer skills
/skill <name>        Charger un skill
/reload              Recharger .env
/reload-mcp          Recharger serveurs MCP
/cron                Gérer cron jobs
```

### Gateway
```
/approve             Approuver commande en attente
/deny                Refuser commande
/restart             Redémarrer gateway
/sethome             Définir canal home
/update              MAJ Hermes
/platforms           Statut plateformes
```

### Info
```
/help                Aide
/commands            Lister toutes les commandes
/usage               Utilisation tokens
/insights [days]     Analytics
/debug               Upload rapport debug
/profile             Info profil actif
```

---

## 6. Cron Jobs

### Fonctionnement

```
┌──────────────────────────────────────────┐
│  CRON SCHEDULER                          │
│  ├── cron/jobs.py      → Stockage jobs   │
│  ├── cron/scheduler.py → Tick loop       │
│  └── .tick.lock        → Anti-doublon    │
│                                          │
│  CHAQUE TICK :                           │
│  1. Vérifie .tick.lock                   │
│  2. Charge jobs actifs                   │
│  3. Pour chaque job éligible :           │
│     → Nouvelle session fraîche           │
│     → Injecte le prompt                  │
│     → Exécute l'agent                    │
│     → Délivre le résultat                │
│     → Détruit la session                 │
│  4. Libère .tick.lock                    │
└──────────────────────────────────────────┘
```

### Syntaxe de planification

| Format | Exemple | Signification |
|--------|---------|---------------|
| Durée | `30m` | Toutes les 30 minutes |
| Every | `every 2h` | Toutes les 2 heures |
| Every day | `every monday 9am` | Chaque lundi à 9h |
| Cron | `0 9 * * *` | Tous les jours à 9h |
| ISO timestamp | `2026-06-01T10:00:00` | Une seule fois |

### Options par job

```python
cronjob(
  action="create",
  name="analyse_crypto",         # Nom unique
  schedule="every 2h",           # Planification
  prompt="Analyse BTC...",       # Prompt auto-suffisant
  skills=["web", "terminal"],    # Skills à charger
  deliver="origin",              # Livraison (origin, all, platform:chat:thread)
  model={"model": "glm-5.2"},   # Override modèle
  workdir="/path/to/project",   # Répertoire de travail
  enabled_toolsets=["web", "terminal", "file"],  # Restreindre outils
  context_from=["job_id_abc"],  # Chaîner avec sortie d'un autre job
  script="collect_data.sh",     # Script pre-run (data collection)
  no_agent=False,                # True = script seul, pas d'agent
  repeat=None,                   # None = récurrent, int = nombre de runs
)
```

### Invariants cron

- **Timeout hard** : 3 minutes par run
- **skip_memory=True** par défaut (pas de mémoire auto)
- **Pas de cron en chaîne** : un cron ne peut pas créer d'autres cron
- **Lock file** empêche doubles ticks
- **Session fraîche** à chaque tick (pas d'injection dans session active)

---

## 7. Intégration MCP

### Architecture MCP dans le gateway

```
┌──────────────────────────────────────────┐
│  AGENT SESSION                           │
│  │                                       │
│  ├── Outils natifs (terminal, file...)   │
│  │                                       │
│  └── MCP Servers                         │
│      ├── HTTP Stream                     │
│      │   ├── memory-server :3099         │
│      │   ├── discord-server :3141        │
│      │   ├── x-mcp-server :3142          │
│      │   └── postgresql-server :5433     │
│      │                                   │
│      └── stdio (si configuré)            │
│          └── custom-command --mcp        │
└──────────────────────────────────────────┘
```

### Configuration MCP

**3 niveaux par agent :**

1. **`.mcp.json`** — Déclare les serveurs disponibles
```json
{
  "mcpServers": {
    "memory-server": {
      "type": "http",
      "url": "http://localhost:3099/mcp"
    }
  }
}
```

2. **`settings.json`** — Active/filtre les serveurs
```json
{
  "enabledMcpjsonServers": ["memory-server", "discord-server"],
  "enableAllProjectMcpServers": false
}
```

3. **`config.yaml`** — Gateway runtime
```yaml
mcp_servers:
  memory-server:
    url: "http://localhost:3099/mcp"
```

### Rechargement MCP

```
/reload-mcp           # Recharger sans restart
/restart              # Restart complet du gateway
```

---

## 8. Sécurité

### Redaction des secrets

```bash
# Masquer les API keys dans le context
hermes config set security.redact_secrets true

# Désactiver
hermes config set security.redact_secrets false
```

⚠️ **Restart requis** — ne prend pas effet mid-session.

### Redaction PII

```bash
# Hasher les user IDs, strip numéros de téléphone
hermes config set privacy.redact_pii true
```

### Modes d'approbation

| Mode | Comportement |
|------|-------------|
| `manual` | Prompt avant chaque commande risquée (défaut) |
| `smart` | LLM auxiliaire auto-approuve les commandes safe |
| `off` | Bypass total (équivalent `--yolo`) |

```bash
hermes config set approvals.mode smart
```

### Allowlist shell hooks

Fichier : `~/.hermes/shell-hooks-allowlist.json`
Première exécution d'un hook → prompt interactif.

---

## 9. Gestion des Sessions

### Architecture

```
~/.hermes/
├── state.db           # Session store (SQLite + FTS5)
├── sessions/
│   ├── routing.json   # Channel → Session mapping
│   └── *.jsonl        # Transcripts (optionnel)
└── logs/
    └── gateway.log    # Logs gateway
```

### Cycle de vie

```
Message entrant
    │
    ├── Canal connu ? → Router vers session existante
    │                     ├── Topic/Thread ? → Sous-session
    │                     └── Canal principal → Session principale
    │
    └── Nouveau canal → Créer nouvelle session
                         ├── Charger config agent
                         ├── Initialiser outils + MCP
                         └── Démarrer boucle agent
```

### Commandes session

```bash
hermes sessions list          # Lister sessions récentes
hermes sessions browse        # Picker interactif
hermes sessions export OUT    # Exporter en JSONL
hermes sessions rename ID T   # Renommer
hermes sessions delete ID     # Supprimer
hermes sessions prune         # Nettoyer vieilles sessions
hermes sessions stats         # Statistiques du store
```

---

## 10. Webhooks

### Configuration

```bash
# Créer une route webhook
hermes webhook subscribe myhook
# → Crée /webhooks/myhook

# Lister
hermes webhook list

# Supprimer
hermes webhook remove myhook

# Test
hermes webhook test myhook
```

### Payload entrant

```json
POST /webhooks/myhook
{
  "message": "Analyse le marché BTC",
  "source": "external_app",
  "metadata": {
    "priority": "high"
  }
}
```

Le gateway traite le payload comme un message utilisateur normal.

---

## 11. Profils

### Concept

Les profils permettent de faire tourner plusieurs instances Hermes isolées :

```
~/.hermes/              # Profil default
~/.hermes/profiles/
├── sniper/             # Profil sniper
│   ├── config.yaml
│   ├── .env
│   ├── skills/
│   └── sessions/
└── researcher/         # Profil researcher
    ├── config.yaml
    └── ...
```

### Commandes

```bash
hermes profile list              # Lister profils
hermes profile create sniper     # Créer (--clone, --clone-all)
hermes profile use sniper        # Définir comme défaut
hermes profile show sniper       # Détails
hermes profile delete sniper     # Supprimer
hermes profile rename A B        # Renommer
hermes profile export sniper     # Export tar.gz
hermes profile import file.tar.gz # Importer
```

### Lancer avec un profil

```bash
hermes --profile sniper
hermes gateway run --profile sniper
```

---

## 12. Credential Pools

Rotation automatique des clés API pour éviter les rate limits.

```bash
hermes auth add             # Ajouter credential (wizard)
hermes auth list [PROVIDER] # Lister credentials
hermes auth remove P INDEX  # Supprimer par provider + index
hermes auth reset PROVIDER  # Reset exhaustion status
```

### Comportement

- Hermes essaie KEY_1 → si 429/401 → KEY_2 → si 429 → KEY_3
- Marque les clés épuisées, les réessaie après cooldown
- Configuré dans `.env` avec clés numérotées

---

## 13. TTS / STT en Gateway

### TTS (Text → Voice)

| Provider | Variable | Coût |
|----------|----------|------|
| Edge TTS | Aucune | Gratuit (défaut) |
| ElevenLabs | `ELEVENLABS_API_KEY` | Freemium |
| OpenAI | `VOICE_TOOLS_OPENAI_KEY` | Payant |
| MiniMax | `MINIMAX_API_KEY` | Payant |
| Mistral | `MISTRAL_API_KEY` | Payant |

Commandes :
```
/voice on       # Voice-to-voice
/voice tts      # Toujours voice
/voice off      # Désactiver
```

### STT (Voice → Text)

Transcription automatique des messages vocaux entrants.

| Provider | Variable | Coût |
|----------|----------|------|
| Local faster-whisper | Aucune | Gratuit |
| Groq Whisper | `GROQ_API_KEY` | Freemium |
| OpenAI Whisper | `VOICE_TOOLS_OPENAI_KEY` | Payant |
| Mistral Voxtral | `MISTRAL_API_KEY` | Payant |

---

## 14. Troubleshooting

### Gateway ne démarre pas

```bash
hermes doctor           # Diagnostic complet
hermes gateway status   # État du service
cat ~/.hermes/logs/gateway.log | tail -50
```

### Bot Discord silencieux

1. Vérifier le **Message Content Intent** dans Discord Developer Portal
2. Vérifier `discord.bot_token` dans config
3. Tester : `hermes gateway status`

### Bot Telegram silencieux

1. Vérifier `telegram.bot_token`
2. Tester : `curl https://api.telegram.org/bot<TOKEN>/getMe`

### Gateway meurt après SSH logout

```bash
sudo loginctl enable-linger $USER
```

### Gateway crash loop (systemd)

```bash
systemctl --user reset-failed hermes-gateway
hermes gateway restart
```

### Outils MCP non disponibles

```bash
hermes mcp list           # Voir serveurs configurés
hermes mcp test NAME      # Tester connexion
/reload-mcp               # Recharger en session
```

### Modèle auxiliaire (vision, compression) ne fonctionne pas

```bash
hermes config set auxiliary.vision.provider openrouter
hermes config set auxiliary.vision.model anthropic/claude-sonnet-4
```

### Memory non persistante

```bash
hermes memory status      # État du provider mémoire
hermes config set memory.memory_enabled true
```

---

## 15. Variables d'Environnement (.env)

Fichier : `~/.hermes/.env`

```bash
# === PROVIDERS ===
OPENROUTER_API_KEY=sk-or-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
DEEPSEEK_API_KEY=sk-...
XAI_API_KEY=xai-...
GLM_API_KEY=xxx.zai...
MINIMAX_API_KEY=xxx
ELEVENLABS_API_KEY=sk_...

# === CREDENTIAL POOL ===
OPENROUTER_API_KEY_2=sk-or-...
OPENROUTER_API_KEY_3=sk-or-...

# === PLATEFORMES ===
DISCORD_BOT_TOKEN=MTk...
TELEGRAM_BOT_TOKEN=123456:ABC...
SLACK_BOT_TOKEN=xoxb-...
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...

# === MCP ===
POSTGRES_CONNECTION_STRING=postgresql://...
```

---

## 16. Chemins Importants

| Chemin | Contenu |
|--------|---------|
| `~/.hermes/config.yaml` | Configuration principale |
| `~/.hermes/.env` | Secrets et clés API |
| `~/.hermes/skills/` | Skills installés |
| `~/.hermes/sessions/` | Routing + transcripts |
| `~/.hermes/state.db` | Session store SQLite |
| `~/.hermes/logs/` | Logs gateway |
| `~/.hermes/auth.json` | OAuth + credential pools |
| `~/.hermes/hermes-agent/` | Code source |
| `~/.hermes/shell-hooks-allowlist.json` | Allowlist hooks |

---

## 17. Flux de Message Complet

```
1. Utilisateur envoie message sur Discord
   │
2. Discord Adapter reçoit via Gateway Intent
   │
3. Session Router lookup (channel_id → session_id)
   │
   ├── Session existe → Continue conversation
   └── Nouvelle session → Crée session fraîche
   │
4. Construction du system prompt
   ├── Config agent (model, tools, persona)
   ├── Memory injectée (user profile + memory notes)
   ├── Skills chargés
   └── MCP tools découverts
   │
5. Appel LLM (OpenAI format)
   │
6. Si tool_calls → Dispatch via model_tools.py
   ├── Outils natifs (terminal, file, web...)
   └── MCP tools (HTTP request au serveur MCP)
   │
7. Résultat outil → Ajouté au context → Retour étape 5
   │
8. Réponse texte finale
   │
9. Gateway envoie via Platform Adapter
   ├── Texte simple → Message texte
   ├── Structuré → Embed Discord / HTML Telegram
   ├── Média → Upload fichier
   └── TTS → Audio + transcription
   │
10. Logs + métriques mis à jour
```

---

*Documentation générée par SniperBot Analyst — Overmind Ecosystem*
*Source : Hermes Agent v2.1+ by Nous Research*
