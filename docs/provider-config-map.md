# Hermes x Overmind — Config Provider Map

## Ordre de resolution (qui gagne, qui perd)

Chaque variable suit cette priorite (la premiere gagne):

```
process.env  (env du parent, herite par le spawn)
      ↓
Workflow/.env  (C:\Users\Deamon\Desktop\Backup\Serveur MCP\Workflow\.env)
      ↓
settings_[agent].json  →  env  (apres interpolation $VAR par process.env)
      ↓
HERMES_HOME/.env  (C:\Users\Deamon\AppData\Local\hermes\.env)  ← DERNIER MOT
```

**Detail du code** (`NousHermesRunner.ts` l.268-456):
1. `agentCustomEnv = { ...process.env, ...settings.env }` (line 268 puis 384)
2. Puis lit `overmindHermesSubPath/.env` (le `.hermes/.env` de l'agent) et fait `agentCustomEnv[key] = value` (line 437-456) — ce qui OVERRIDE tout ce qui precede.
3. Finalement ecrit ce `agentCustomEnv` dans le `.env` final de l'agent (line 722-732) avec dedup sur les cles `*api_key` / `*auth_token`.

Donc le `.hermes/.env` de l'agent a **toujours le dernier mot**. Si tu mets `MINIMAX_API_KEY=*** dans le .hermes/.env, il ecrase `MINIMAX_API_KEY` du process.env et du settings.

**MAIS** pour `OPENROUTER_API_KEY` uniquement:
- Hermes lit d'abord `HERMES_HOME/.env` puis `os.environ`
- Si present dans `auth.json` avec status `exhausted` → skip
- Si present dans `HERMES_HOME/.env` (meme vide `""`) → **PREND LA PRIORITE sur process.env**

**MAIS** pour tous les autres providers (zai, minimax-cn, etc.):
- Hermes lit `HERMES_HOME/.env` → si vide/null → lit `os.environ`
- `os.environ` contient tout ce que le parent a passe (donc le `.env` du Workflow)

---

## Les 5 fichiers cles

| Fichier | Role |
|---|---|
| `HERMES_HOME/.env` | API keys globales Hermes (fallback) |
| `Workflow/.env` | Variables du workflow (DB, tokens, etc.) |
| `settings_[agent].json` | Config par agent (model, provider, tokens, MCP) |
| `HERMES_HOME/.hermes/config.yaml` | Config systeme Hermes (model.default, provider, etc.) |
| `HERMES_HOME/auth.json` | Credential pool — status des tokens (ok/exhausted), URLs par provider |

---

## Les 2 endpoints Z.AI (DECOUVERTE CRITIQUE)

Z.AI a **deux endpoints distincts** — confusion entre les deux causait des erreurs 402:

| Endpoint | URL | Usage |
|---|---|---|
| **Coding** (celui qu'il faut) | `https://api.z.ai/api/coding/paas/v4` | Inference LLM (Hermes, Overmind) |
| **Non-coding** (ancien, different billing) | `https://api.z.ai/api/paas/v4` | Autre chose (pas le meme systeme de facturation) |

**Comment le credential pool est seed:**

| Source dans .env | Cle dans auth.json | base_url assignee |
|---|---|---|
| `ZAI_ANTHROPIC_FALLBACK_KEY` | `zai[0].access_token` | `https://api.z.ai/api/coding/paas/v4` ✅ |
| `Z_AI_API_KEY` | `zai[1].access_token` | `https://api.z.ai/api/paas/v4` ❌ (ancien) |

Le premier entry (priority 0) est utilise en premier. C'est celui qui est seed par `writeAuthJson()` dans `NousHermesRunner.ts` → `ZAI_ANTHROPIC_FALLBACK_KEY`.

---

## Provider → Ce qu'Hermes attend

### Z.AI (id: `zai`)

| Param | Valeur attendue | Source dans Hermes |
|---|---|---|
| Provider ID | `zai` | config.yaml ou settings |
| API Key | `ZAI_ANTHROPIC_FALLBACK_KEY` (cle primaire) ou `Z_AI_API_KEY` (fallback ancien) | `HERMES_HOME/.env` → `os.environ` |
| Base URL | `https://api.z.ai/api/coding/paas/v4` | credential pool (seed par writeAuthJson) |
| Model | `glm-5.1` | settings `env.ANTHROPIC_MODEL` |

```json
// settings_[agent].json — Z.AI correct
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ZAI_ANTHROPIC_FALLBACK_KEY",
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/coding/paas/v4",
    "ANTHROPIC_MODEL": "glm-5.1"
  }
}
```

```bash
# .env minimal pour Z.AI
ZAI_ANTHROPIC_FALLBACK_KEY=5f650035e5a845549e4765184d8179b1.GdehlMpHT0dKq3m3
```

Le credential pool `auth.json` est ecrit par `writeAuthJson()` dans `NousHermesRunner.ts`. La cle `ZAI_ANTHROPIC_FALLBACK_KEY` est envoyee par `agentCustomEnv` → Hermes seed le credential pool avec le bon endpoint.

---

### Z.AI Multi-Token (E/Y)

Deamon a 2 tokens Z.AI (E=primary, Y=secondary). Le credential pool peut contenir les deux:

| Token | Label dans auth.json | Cle dans .env |
|---|---|---|
| Primary | `ANTHROPIC_AUTH_TOKEN_E` | `ANTHROPIC_AUTH_TOKEN_E` = `5f65...q3m3` |
| Secondary | `ANTHROPIC_AUTH_TOKEN_Y` | `ANTHROPIC_AUTH_TOKEN_Y` = `c78a...1ISt` |

Pour qu'un agent utilise le token Y (secondary) au lieu de E (primary), le settings doit utiliser `$ANTHROPIC_AUTH_TOKEN_Y` au lieu de `$ANTHROPIC_AUTH_TOKEN_E`.

---

### MiniMax CN (id: `minimax-cn`)

| Param | Valeur attendue | Source dans Hermes |
|---|---|---|
| Provider ID | `minimax-cn` | config.yaml ou settings |
| API Key | `MINIMAX_CN_API_KEY` **uniquement** | `HERMES_HOME/.env` → `os.environ` |
| Base URL | `https://api.minimaxi.com/anthropic` | hardcoded dans ProviderConfig |
| Model | `MiniMax-M2.7` | settings `env.ANTHROPIC_MODEL` |

```json
// settings_[agent].json — MiniMax correct
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$MINIMAX_CN_API_KEY",
    "ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic",
    "ANTHROPIC_MODEL": "MiniMax-M2.7"
  }
}
```

```bash
# .env minimal pour MiniMax
MINIMAX_CN_API_KEY=ton_token_minimax_ici
```

**auth.json** stocke sous `MINIMAX_CN_API_KEY`.

---

### OpenRouter — BANNIR pour LLM

| Param | Valeur attendue | Source |
|---|---|---|
| Provider ID | — | **Ne PAS utiliser** |
| API Key | `OPENROUTER_API_KEY` | `HERMES_HOME/.env` → `os.environ` |
| Base URL | `https://openrouter.ai/api/v1` | hardcoded |
| Guardrail | — | Force 404 si active |

**PROBLEME:** Si `OPENROUTER_API_KEY` est present (meme dans `OVERMIND_EMBEDDING_KEY` route via NousHermesRunner), Hermes le detecte et tente OpenRouter pour l'inference.

**auth.json** a une entree OpenRouter — si le status est `exhausted`, Hermes ne retry plus mais peut quand meme picker le provider "openrouter" dans le credential pool.

---

## Comment Hermes decide quel provider utiliser

Il y a DEUX niveaux de decision:

### Niveau 1: Overmind runner (avant spawn)

`NousHermesRunner.writeAuthJson()` (l.782-918) vote entre 3 signaux pour determiner le `effectiveProvider` qui sera seed dans `auth.json` et le `.env` de l'agent:

1. **Token prefix** (le plus fiable) — `detectTokenProvider()` reconnait:
   - `sk-cp-...` ou `sk-mm-...` → `minimax`
   - `32hex.32hex` ou 32-char hex → `zai`
   - `sk-ant-...` → `anthropic`
   - `sk-or-...` → `openrouter` (mais BLOQUE pour LLM par la suite)
   - `sk-...` (autre) → `openai`
2. **BASE_URL** (tres fiable, plus specifique que le token pour CN vs GLOBAL) — `api.minimaxi.com` → `minimax-cn`, `api.minimax.com` → `minimax`, `api.z.ai/api/coding/paas/v4` → `zai`, `anthropic.com` → `anthropic`, `openai.com` → `openai`.
3. **ANTHROPIC_PROVIDER** hint du settings (le moins fiable).

**Cas special CN vs GLOBAL**: `sk-cp-` est ambigu entre `minimax` et `minimax-cn` (meme prefix). Si l'URL dit `minimaxi` (avec le `i`), c'est CN. Si `minimax` (sans le `i`), c'est GLOBAL. **L'URL gagne dans ce cas precis** parce qu'elle est la seule a desambiguïser.

### Niveau 2: Hermes upstream (apres spawn)

Hermes relit son `auth.json` + `HERMES_HOME/.env` + `os.environ` avec sa propre logique (dans `hermes_cli/auth.py`):

```
1.  Si `provider` explicite dans config.yaml → utilise ce provider
2.  Sinon si `ANTHROPIC_BASE_URL` contient openrouter → "openrouter"
3.  Sinon lit model name → compare avec model_defaults par provider
    - "glm-*"  → "zai"
    - "MiniMax-*" → "minimax-cn"
4.  Sinon fallback: model.default dans config.yaml
```

**Le runner a deja vote au Niveau 1** — donc ce que tu mets dans `auth.json` (via `writeAuthJson()`) determine ce qu'Hermes verra au Niveau 2. Si le runner a seed `minimax-cn` mais que `config.yaml` dit `provider: minimax`, Hermes va probablement se plaindre. **Garde les deux alignes** ou laisse le runner ecrire le `config.yaml` (ce qu'il fait deja a chaque run).

---

## Comment NousHermesRunner passe les vars a Hermes

Le runner lit `settings_[agent].json` → applique `interpolateEnvVars()` qui remplace `$VAR` par `process.env[VAR]` → envoie le tout dans `agentCustomEnv` au processus Hermes.

```typescript
// Ce que NousHermesRunner.ts passe a Hermes (agentCustomEnv)
const agentCustomEnv = {
  ...process.env,           // HERMES_HOME/.env + Workflow/.env fusionnes
  PYTHONIOENCODING: 'utf-8',
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',  // VIDE (fixe)
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || process.env.NVAPI_KEY,
  ANTHROPIC_AUTH_TOKEN: s.env.ANTHROPIC_AUTH_TOKEN,  // interpolate
  ANTHROPIC_BASE_URL: s.env.ANTHROPIC_BASE_URL,      // interpolate
  ANTHROPIC_MODEL: s.env.ANTHROPIC_MODEL,             // interpolate
};
```

Puis lance Hermes avec `--env-file` pour discord_llm + Workflow `.env` (via startpipeline.js).

---

## Le probleme de OPENROUTER_API_KEY

**AVANT le fix:**
```typescript
OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || process.env.OVERMIND_EMBEDDING_KEY,
```
→ Si `OPENROUTER_API_KEY` vide mais `OVERMIND_EMBEDDING_KEY` present → passe quand meme une cle OpenRouter a Hermes → Hermes detecte `OPENROUTER_API_KEY` → tente OpenRouter → 404 guardrail.

**APRES le fix:**
```typescript
OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
```
→ `OVERMIND_EMBEDDING_KEY` n'est plus redirige. Si `OPENROUTER_API_KEY` absent du `.env`, Hermes recoit string vide et ne pick pas OpenRouter.

---

## Comment Hermes obtient la API Key (le vrai flux)

Le `ANTHROPIC_AUTH_TOKEN` dans `settings.json` **ne passe pas directement** dans le body de la requete API. Hermes utilise son propre credential pool:

```
settings_[agent].json
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ZAI_ANTHROPIC_FALLBACK_KEY",  ← Runner remplace $VAR → "token_reel"
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/coding/paas/v4",
    "ANTHROPIC_MODEL": "glm-5.1"
  }
  ↓ (interpolateEnvVars par NousHermesRunner)
agentCustomEnv envoye a Hermes:
  ANTHROPIC_AUTH_TOKEN=token_reel
  ANTHROPIC_BASE_URL=https://api.z.ai/api/coding/paas/v4
  ANTHROPIC_MODEL=glm-5.1

MAIS Hermes ne lit PAS ANTHROPIC_AUTH_TOKEN directement.
Hermes lit le CREDENTIAL POOL (auth.json) + les .env vars listees dans api_key_env_vars.

Credential pool est seed par:
  ZAI_ANTHROPIC_FALLBACK_KEY  →  "zai" avec base_url coding ✅
  Z_AI_API_KEY               →  "zai" avec base_url non-coding (ancien)
  MINIMAX_CN_API_KEY         →  "minimax-cn"
```

Le `$VAR` dans `ANTHROPIC_AUTH_TOKEN` est juste une convenience pour que le token traverse le runner et arrive dans `process.env` du subprocess Hermes. C'est `process.env.ZAI_ANTHROPIC_FALLBACK_KEY` qui seed le credential pool.

---

## Le flow complet (Z.AI par exemple)

1. `Workflow/.env` contient `ZAI_ANTHROPIC_FALLBACK_KEY=<TOKEN>`
2. `startpipeline.js` charge `.env` → `process.env.ZAI_ANTHROPIC_FALLBACK_KEY`
3. ` NousHermesRunner` lit `settings_zai.json` → `interpolateEnvVars()`
   - `$ZAI_ANTHROPIC_FALLBACK_KEY` → `process.env["ZAI_ANTHROPIC_FALLBACK_KEY"]` → `"<TOKEN>"`
   - `ANTHROPIC_AUTH_TOKEN="<TOKEN>"` (valeur concrete maintenant)
4. `agentCustomEnv` envoye a Hermes:
   - `ANTHROPIC_AUTH_TOKEN=<TOKEN>`
   - `ANTHROPIC_BASE_URL=https://api.z.ai/api/coding/paas/v4`
   - `ANTHROPIC_MODEL=glm-5.1`
5. Hermes fait son propre lookup:
   - `load_pool("zai")` → `_resolve_api_key_provider_secret("zai")`
   - Cherche `ZAI_ANTHROPIC_FALLBACK_KEY` via `_get_env_prefer_dotenv()` dans `HERMES_HOME/.env` puis `os.environ`
   - Trouve dans `os.environ` (herite du parent)
   - `writeAuthJson()` ecrit dans `auth.json` avec base_url `https://api.z.ai/api/coding/paas/v4`
6. API call → utilise le credential pool entry pour `zai` avec le bon endpoint

---

## OPENROUTER et Les Embeddings

**`OVERMIND_EMBEDDING_KEY`** = clef OpenRouter pour les **embeddings uniquement** (PostgresMemoryProvider du Workflow). Elle est dans le `.env` Overmind. Hermes n'a pas besoin de la voir pour l'LLM inference.

**NousHermesRunner ne doit jamais forwarder de clef OpenRouter a Hermes.** OpenRouter n'est pas un provider LLM dans ce setup. Si `OPENROUTER_API_KEY` arrive jusqu'a Hermes, il detecte la clef et tente OpenRouter pour l'inference → 404 guardrail.

**Fix applique:**
```typescript
OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
```

---

## Le config.yaml ecrit par NousHermesRunner (exemple sniperbot_analyst)

```yaml
mcp_servers:
  memory-server:
    url: "http://localhost:3099/mcp"
  discord-server:
    url: "http://localhost:3141/mcp"
  x-mcp-server:
    url: "http://localhost:3142/mcp"
  postgresql-server:
    url: "http://localhost:5433/mcp"

model:
  default: glm-5.1
  provider: z-ai

tts:
  provider: elevenlabs
  voice: charlie
  voice_id: IKne3meq5aSn9XLyUdCD
  model: eleven_multilingual_v2
```

Ce config est ecrit dans `.overmind/hermes/agent_<name>/.hermes/config.yaml` a chaque run. Les valeurs viennent de `settings_<agent>.json` + defaults.

---

## Checklist pour ajouter un nouveau provider

1. **Verifier le ProviderConfig** dans `hermes-agent/hermes_cli/auth.py`
   - Verifier `api_key_env_vars` (les vars que Hermes cherche)
   - Verifier `inference_base_url` (URL par defaut)
   - Verifier `base_url_env_var` (optionnel, surcharge URL)

2. **Ajouter dans Workflow/.env**
   ```bash
   MAISON_API_KEY=cle_api_du_fournisseur
   ```

3. **Ajouter dans settings_[agent].json**
   ```json
   {
     "env": {
       "ANTHROPIC_AUTH_TOKEN": "$MAISON_API_KEY",
       "ANTHROPIC_BASE_URL": "https://api.fournisseur.com/v1",
       "ANTHROPIC_MODEL": "model-name"
     }
   }
   ```

4. **Verifier auth.json** — apres premiere utilisation, Hermes stocke le token avec status.
   - Si `exhausted` → Hermes skip ce provider automatiquement
   - Si `ok` → utilise le token

5. **NE JAMAIS** faire de mapping `AUTRE_CHOSE_API_KEY → OPENROUTER_API_KEY` — ca force OpenRouter.

6. **Pour eviter OpenRouter:** pas de `OPENROUTER_API_KEY` dans `HERMES_HOME/.env`

---

## Resume

| Tu veux... | Utilise ces vars |
|---|---|
| Z.AI (glm-5.1) | `ZAI_ANTHROPIC_FALLBACK_KEY` dans `.env` + settings `$ZAI_ANTHROPIC_FALLBACK_KEY` |
| Z.AI secondary (token Y) | `ANTHROPIC_AUTH_TOKEN_Y` dans `.env` + settings `$ANTHROPIC_AUTH_TOKEN_Y` |
| MiniMax CN | `MINIMAX_CN_API_KEY` dans `.env` + settings `$MINIMAX_CN_API_KEY` |
| Embeddings OpenRouter | `OVERMIND_EMBEDDING_KEY` (pour embeddings, PAS LLM) |
| Eviter OpenRouter LLM | Pas de `OPENROUTER_API_KEY` dans `HERMES_HOME/.env` |

---

## Gemini / @google/gemini-cli (id: `gemini`)

Le runner `gemini` utilise **`@google/gemini-cli`** (npm, v0.43.0) en headless mode.
Le CLI est installé via `npm install -g @google/gemini-cli` et disponible dans le PATH.

### Installation

```bash
npm install -g @google/gemini-cli
gemini --version  # → 0.43.0
```

### Flags CLI utilisés

| Flag | Valeur | Rôle |
|---|---|---|
| `-p` / `--prompt` | prompt text | Mode headless (non-interactif) |
| `--approval-mode` | `yolo` | Auto-approve tous les outils |
| `--session-id` | UUID | Session persistante entre appels |
| `--acp` | (flag) | Active le protocol agent (ACP) |
| `--model` | `antigravity/<MODE>` | Passe le mode Antigravity comme contexte |
| `--output-format` | `json` | Output structuré pour parser session_id |

### Commandes equivalents (CLI direct)

```bash
# Test quick
gemini -p "Dis-moi bonjour" --approval-mode yolo

# Avec session
gemini -p "Analyse ce code" --approval-mode yolo --session-id <uuid> --acp

# Mode PLAN
gemini -p "Planifie cette tache" --model antigravity/PLAN --approval-mode yolo --acp

# List sessions
gemini --list-sessions
```

### Modes Antigravity (parametre `mode`)

Le mode est passe via `--model antigravity/<MODE>` pour donner du contexte au modele.

|| Mode | Usage |
|---|---|
| `GENERAL` | Mode par defaut, taches polyvalentes |
| `CONTEXT_CHECK` | Verification de contexte code |
| `PLAN` | Planification de taches complexes |
| `COMMAND` | Execution de commandes shell |
| `CASCADE` | Execution en cascade multi-agents |
| `EVAL` | Evaluation et revue de code |
| `ANTIGRAVITY_REVIEW` | Revue automatique Antigravity |
| `MQUERY` | Recherche multi-source |
| `COMMIT_MESSAGE` | Generation de messages de commit |
| `CHECKPOINT` | Sauvegarde de checkpoint |
| `FAST_APPLY` | Application rapide de patches |

### Utilisation Overmind (run_agent)

```typescript
// run_agent avec runner: 'gemini'
const result = await runAgent({
  runner: 'gemini',  // GeminiRunner → gemini CLI npm
  prompt: 'Analyse ce code',
  agentName: 'expert_python',
  mode: 'GENERAL',  // GENERAL, PLAN, COMMAND, CASCADE, EVAL, etc.
  autoResume: false,
  configPath: './Workflow',
});

// ou directement via run_gemini.ts
const result = await runGeminiAgent({
  prompt: '...',
  mode: 'PLAN',
});
```

### Configuration agent

Chaque agent stocke sa config dans `.antigravity/agent_<nom>/`:
- `mcp.json` — serveurs MCP actifs (copies depuis settings_<agent>.json)
- Session store — sessions persistees

### Verification installation

```bash
gemini --version
# → 0.43.0

gemini mcp list
# → liste les MCP servers configures
```

### Erreurs connues

| Erreur | Cause | Fix |
|---|---|---|
| `GEMINI_CLI_NOT_INSTALLED` | `@google/gemini-cli` pas dans le PATH | `npm install -g @google/gemini-cli` |
| `EXIT_CODE_1` | Session invalide ou prompt rejete | Retry sans sessionId |
| `TIMEOUT` | Reponse > 15min | Augmente `CONFIG.TIMEOUT_MS` |

### Ce qui a change (historique)

|| Avant (session 2025) | Maintenant |
|---|---|---|
| Spawn `language_server_windows_x64.exe` avec flags inexistants | Spawn `gemini` (npm bin) avec flags reels |
| `--mode --prompt-file --session --output-format` (flags Go inexistants) | `-p --approval-mode yolo --session-id --acp --model --output-format json` |
| Auth via OAuth interne Antigravity IDE | Auth via Google account du CLI npm |
| Config `.antigravity/<agent>/` | Config `.antigravity/<agent>/` (MCP + sessions) |