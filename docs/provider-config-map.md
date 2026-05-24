# Hermes x Overmind — Config Provider Map

## Ordre de resolution (qui gagne, qui perd)

Chaque variable suit cette priorite (la premiere gagne):

```
HERMES_HOME/.env  (C:\Users\Deamon\AppData\Local\hermes\.env)
      ↓
settings_[agent].json  →  env  (apres interpolation $VAR par process.env)
      ↓
Workflow/.env  (C:\Users\Deamon\Desktop\Backup\Serveur MCP\Workflow\.env)
      ↓
process.env  (env du parent, heredite par le spawn)
```

**MAIS** pour `OPENROUTER_API_KEY` uniquement:
- Hermes lit d'abord `HERMES_HOME/.env` puis `os.environ`
- Si present dans `auth.json` avec status `exhausted` → skip
- Si present dans `HERMES_HOME/.env` (meme vide `""`) → **PREND LA PRIORITE sur process.env**

**MAIS** pour tous les autres providers (zai, minimax-cn, etc.):
- Hermes lit `HERMES_HOME/.env` → si vide/null → lit `os.environ`
- `os.environ` contient tout ce que le parent a passe (donc le `.env` du Workflow)

---

## Les 4 fichiers cles

| Fichier | Role |
|---|---|
| `HERMES_HOME/.env` | API keys globales Hermes |
| `Workflow/.env` | Variables du workflow (DB, tokens, etc.) |
| `settings_[agent].json` | Config par agent (model, provider, tokens, MCP) |
| `HERMES_HOME/.hermes/config.yaml` | Config systeme Hermes (model.default, provider, etc.) |
| `HERMES_HOME/auth.json` | Credential pool — status des tokens (ok/exhausted) |

---

## Provider → Ce qu'Hermes attend

### Z.AI (id: `zai`)

| Param | Valeur attendue | Source dans Hermes |
|---|---|---|
| Provider ID | `zai` | config.yaml ou settings |
| API Key | Une de: `GLM_API_KEY`, `ZAI_API_KEY`, `Z_AI_API_KEY` | `HERMES_HOME/.env` → `os.environ` |
| Base URL | `https://api.z.ai/api/paas/v4` | hardcoded dans ProviderConfig |
| Model | `glm-5.1` | settings `env.ANTHROPIC_MODEL` |

```json
// settings_[agent].json — Z.AI correct
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$GLM_API_KEY",
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/paas/v4",
    "ANTHROPIC_MODEL": "glm-5.1"
  }
}
```

```bash
# .env minimal pour Z.AI
GLM_API_KEY=ton_token_zai_ici
```

**auth.json** stocke aussi la cle sous `Z_AI_API_KEY` (label: `GLM_API_KEY`, status: `ok`).

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
| Provider ID | — | Ne PAS utiliser |
| API Key | `OPENROUTER_API_KEY` | `HERMES_HOME/.env` → `os.environ` |
| Base URL | `https://openrouter.ai/api/v1` | hardcoded |
| Guardrail | — | Force 404 si active |

**PROBLEME:** Si `OPENROUTER_API_KEY` est present (meme dans `OVERMIND_EMBEDDING_KEY` route via NousHermesRunner), Hermes le detecte et tente OpenRouter pour l'inference.

**auth.json** a une entree OpenRouter — si le status est `exhausted`, Hermes ne retries plus mais peut quand meme picker le provider "openrouter" dans le credential pool.

---

## Comment Hermes decide quel provider utiliser

```
1.  Si `provider` explicite dans settings.json → utilise ce provider
2.  Sinon si `ANTHROPIC_BASE_URL` contient openrouter → "openrouter"
3.  Sinon lit model name → compare avec model_defaults par provider
    - "glm-*"  → "zai"
    - "MiniMax-*" → "minimax-cn"
4.  Sinon fallback: "minimax-cn" (model.default dans config.yaml)
```

Le model resolve le provider. Donc `ANTHROPIC_MODEL=glm-5.1` sans provider explicite → `zai`. `ANTHROPIC_MODEL=MiniMax-M2.7` → `minimax-cn`.

---

## Comment NousHermesRunner passe les vars a Hermes

Le runner lit `settings_[agent].json` → applique `interpolateEnvVars()` qui remplace `$VAR` par `process.env[VAR]` → envoie le tout dans `agentCustomEnv` au processus Hermes.

```typescript
// Ce que NousHermesRunner.ts passe a Hermes (ligne 261-269)
const agentCustomEnv = {
  ...process.env,           // HERMES_HOME/.env + Workflow/.env fusionnes
  PYTHONIOENCODING: 'utf-8', // ...
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',  // VIDE maintenant (fixe)
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || process.env.NVAPI_KEY,
  ANTHROPIC_AUTH_TOKEN: s.env.ANTHROPIC_AUTH_TOKEN,  // deja interpolate
  ANTHROPIC_BASE_URL: s.env.ANTHROPIC_BASE_URL,      // deja interpolate
  ANTHROPIC_MODEL: s.env.ANTHROPIC_MODEL,             // deja interpolate
};
```

Puis lance Hermes avec `--env-file` pour discord_llm + Workflow `.env` (via startpipeline.js).

---

## Le probleme de OPENROUTER_API_KEY

**AVANT le fix:**
```typescript
OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || process.env.OVERMIND_EMBEDDING_KEY,
```
→ Si `OPENROUTER_API_KEY` vide mais `OVERMIND_EMBEDDING_KEY` present → passe quand meme une cle OpenRouter a Hermes → Hermes detecte `OPENROUTER_API_KEY` dans credential pool → tente OpenRouter → 404 guardrail.

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
    "ANTHROPIC_AUTH_TOKEN": "$GLM_API_KEY",  ← Runner remplace $GLM_API_KEY → "token_reel"
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/paas/v4",
    "ANTHROPIC_MODEL": "glm-5.1"
  }
  ↓ (interpolateEnvVars par NousHermesRunner)
agentCustomEnv envoye a Hermes:
  ANTHROPIC_AUTH_TOKEN=token_reel
  ANTHROPIC_BASE_URL=https://api.z.ai/api/paas/v4
  ANTHROPIC_MODEL=glm-5.1

MAIS Hermes ne lit PAS ANTHROPIC_AUTH_TOKEN directement.
Hermes lit le CREDENTIAL POOL (auth.json) + les .env vars listees dans api_key_env_vars.

Credential pool est seed par:
  GLM_API_KEY, ZAI_API_KEY, Z_AI_API_KEY  →  "zai"
  MINIMAX_CN_API_KEY                       →  "minimax-cn"

Le ANTHROPIC_AUTH_TOKEN dans settings.json sert a RIEN pour le credential pool.
Il est juste envoye dans agentCustomEnv mais Hermes l'ignore.
```

Le `$GLM_API_KEY` dans `ANTHROPIC_AUTH_TOKEN` est juste une convenience pour que le token traverse le runner et arrive dans `process.env` du subprocess Hermes. C'est `process.env.GLM_API_KEY` qui seed le credential pool.

---

## Le flow complet (Z.AI par exemple)

1. `Workflow/.env` contient `GLM_API_KEY=<VOTRE_TOKEN_ZAI>`
2. `startpipeline.js` charge `.env` → `process.env.GLM_API_KEY`
3. ` NousHermesRunner` lit `settings_zai.json` → `interpolateEnvVars()`
   - `$GLM_API_KEY` → `process.env["GLM_API_KEY"]` → `"<TOKEN>"`
   - `ANTHROPIC_AUTH_TOKEN="<TOKEN>"` (valeur concrete maintenant)
4. `agentCustomEnv` envoye a Hermes:
   - `ANTHROPIC_AUTH_TOKEN=<TOKEN>`
   - `ANTHROPIC_BASE_URL=https://api.z.ai/api/paas/v4`
   - `ANTHROPIC_MODEL=glm-5.1`
5. Hermes fait son propre lookup:
   - `load_pool("zai")` → `_resolve_api_key_provider_secret("zai")`
   - Cherche `GLM_API_KEY` via `_get_env_prefer_dotenv()` dans `HERMES_HOME/.env` puis `os.environ`
   - Trouve `GLM_API_KEY=<TOKEN>` dans `os.environ` (herite du parent)
   - Stocke dans `auth.json` avec status `ok`
6. API call → utilise le credential pool entry pour `zai`

**Meme valeur, deux lectures differentes** — les deux convergent parce que le token est identique dans `HERMES_HOME/.env` et dans `process.env` (qui herite du `.env` charge). Si `GLM_API_KEY` est absent du `.env` mais present dans `HERMES_HOME/.env` → ca marche aussi (HERMES_HOME/.env est lu en priorite par `_get_env_prefer_dotenv`).

---

## OPENROUTER et Les Embeddings

**`OVERMIND_EMBEDDING_KEY`** = clef OpenRouter pour les **embeddings uniquement** (PostgresMemoryProvider du Workflow). Elle est dans le `.env` Overmind par defaut. Hermes n'a pas besoin de la voir pour l'LLM inference.

**NousHermesRunner ne doit jamais forwarder de clef OpenRouter a Hermes.** OpenRouter n'est pas un provider LLM dans ce setup. Si `OPENROUTER_API_KEY` arrive jusqu'a Hermes, il detecte la clef et tente OpenRouter pour l'inference → 404 guardrail.

**Fix applique:**
```typescript
OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
```
On envoit un string vide si absent, pour etre explicite: "OpenRouter nest pas configure pour LLM ici."

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

|| Tu veux... | Utilise ces vars |
|---|---|
| Z.AI (glm-5.1) | `GLM_API_KEY` dans `.env` + settings `$GLM_API_KEY` |
| MiniMax CN | `MINIMAX_CN_API_KEY` dans `.env` + settings `$MINIMAX_CN_API_KEY` |
| Embeddings OpenRouter | `OVERMIND_EMBEDDING_KEY` (pour embeddings, PAS LLM) |
| Eviter OpenRouter LLM | Pas de `OPENROUTER_API_KEY` dans `HERMES_HOME/.env` |

---

## Gemini / Antigravity (id: `gemini`)

**Ancien `gemini-cli` (npm `@google/gemini-cli`) est remplacé.**

Le runner `gemini` dans Overmind utilise maintenant **Antigravity CLI**, bundlé dans **Antigravity IDE**. Le fichier `GeminiRunner.ts` a été refactorisé pour utiliser le CLI d'Antigravity au lieu du package npm `gemini-cli`.

### Ce qui a changé

| Avant | Après |
|---|---|
| `GeminiRunner` → spawn `node .../@google/gemini-cli/bundle/gemini.js` | `GeminiRunner` → spawn `Antigravity IDE.exe` avec `--mode`, `--prompt-file`, etc. |
| Auth via sync `.gemini/` OAuth | Auth via OAuth interne Antigravity (pas de sync) |
| Config `.overmind/gemini/` | Config `.antigravity/<agent>/` local |
| Modes limitées | Modes: GENERAL, CONTEXT_CHECK, PLAN, COMMAND, CASCADE, EVAL, ANTIGRAVITY_REVIEW, MQUERY, COMMIT_MESSAGE, CHECKPOINT, FAST_APPLY |

### Installation

Antigravity IDE est déjà installé sur cette machine:

```bash
C:\Users\Deamon\AppData\Local\Programs\Antigravity IDE\Antigravity IDE.exe
```

Le runner vérifie sa présence et retourne `ANTIGRAVITY_NOT_INSTALLED` si absent.

### Chemins clés

| Ressource | Path |
|---|---|
| CLI Executable | `C:\Users\Deamon\AppData\Local\Programs\Antigravity IDE\Antigravity IDE.exe` |
| Resources App | `C:\Users\Deamon\AppData\Local\Programs\Antigravity IDE\resources\app` |
| Language Server | `C:\Users\Deamon\AppData\Local\Programs\Antigravity IDE\resources\app\bin\language_server_windows_x64.exe` |
| CLI Node | `C:\Users\Deamon\AppData\Local\Programs\Antigravity IDE\resources\app\out\cli.js` |

### Utilisation Overmind (run_agent)

Le runner `gemini` est utilisé via `run_agent.ts` — même nom, nouvelle implémentation:

```typescript
// run_agent avec runner: 'gemini'
const result = await runAgent({
  runner: 'gemini',  // ← GeminiRunner qui utilise Antigravity CLI en interne
  prompt: 'Analyse ce code',
  agentName: 'expert_python',
  mode: 'GENERAL',   // GENERAL, PLAN, COMMAND, CASCADE, EVAL, etc.
  autoResume: false,
  configPath: './Workflow',
});

// ou directement via run_gemini.ts
const result = await runGeminiAgent({
  prompt: '...',
  mode: 'PLAN',
});
```

### Modes Antigravity (paramètre `mode`)

| Mode | Usage |
|---|---|
| `GENERAL` | Mode par défaut, tâches polyvalentes |
| `CONTEXT_CHECK` | Vérification de contexte code |
| `PLAN` | Planification de tâches complexes |
| `COMMAND` | Exécution de commandes shell |
| `CASCADE` | Exécution en cascade multi-agents |
| `EVAL` | Évaluation et revue de code |
| `ANTIGRAVITY_REVIEW` | Revue automatique Antigravity |
| `MQUERY` | Recherche multi-source |
| `COMMIT_MESSAGE` | Génération de messages de commit |
| `CHECKPOINT` | Sauvegarde de checkpoint |
| `FAST_APPLY` | Application rapide de patches |

### Configuration agent

Chaque agent peut avoir sa config dans `.antigravity/agent_<nom>/`:
- `mcp.json` — serveurs MCP actifs
- Session store — sessions Gemini persistées

### Différences avec l'ancien gemini-cli (npm)

```json
// settings_<agent>.json — Antigravity
{
  "env": {
    "ANTIGRAVITY_MODE": "GENERAL",
    "ANTIGRAVITY_DIR": ".antigravity/agent_<name>"
  }
}
```

### Vérification installation

```typescript
import { isAntigravityInstalled } from './services/AntigravityRunner.js';

if (isAntigravityInstalled()) {
  console.log('Antigravity IDE est installé');
} else {
  console.log('Antigravity IDE non trouvé');
}
```