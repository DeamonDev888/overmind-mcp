LA SUBTILISATION — comment Overmind devine ton provider LLM à partir de ton token
==============================================================================

Version: Overmind 2.8.27 (2026-06-07)
Hermes requis: v0.16.0+


Concept (1 phrase)
------------------
Le runner Overmind ne te demande PAS quel provider tu utilises.
Il LIT ton token, en déduit le préfixe, et MAPPE automatiquement
vers le bon env var que le plugin provider de Hermes attend.


Pourquoi ça existe
-----------------
Les tokens de providers LLM ont des préfixes distincts que tu ne
connais peut-être pas :

   sk-cp-...    ->  MiniMax    (env: MINIMAX_API_KEY, MINIMAX_CN_API_KEY)
   sk-mm-...    ->  MiniMax    (variante)
   sk-ant-...   ->  Anthropic  (env: ANTHROPIC_AUTH_TOKEN)
   sk-or-...    ->  OpenRouter (BLOQUÉ pour LLM, embeddings only)
   sk-...       ->  OpenAI     (env: OPENAI_API_KEY)
   32hex.32hex  ->  Z.AI / GLM (env: ZAI_ANTHROPIC_FALLBACK_KEY, GLM_API_KEY)
   32hex        ->  Z.AI       (variante single-block)
   16hex+       ->  Z.AI       (catch-all hex)


CAS SPÉCIAL : sk-cp- est ambigu entre MiniMax GLOBAL et MiniMax CN
------------------------------------------------------------------
Meme prefix. Pour desambiguïser, le runner regarde l'ANTHROPIC_BASE_URL :
  - api.minimaxi.com (avec le i) -> minimax-cn
  - api.minimax.com  (sans le i) -> minimax (GLOBAL)
L'URL gagne dans ce cas parce qu'elle est la seule a desambiguïser.

Ce que tu mets dans settings_<agent>.json :

{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN_2",
    "ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic",
    "ANTHROPIC_MODEL": "MiniMax-M3",
    "ANTHROPIC_PROVIDER": "minimax-cn"
  }
}

Le runner voit ANTHROPIC_BASE_URL contient "minimaxi" -> effectiveProvider = minimax-cn.
Il seed auth.json avec MINIMAX_CN_API_KEY et the bon endpoint.
Hermes route vers le plugin minimax-cn.


CONVENTION : MiniMax = CN par defaut
-------------------------------------
Le prefixe sk-cp- est partage entre MiniMax GLOBAL (api.minimax.com) et
MiniMax CN (api.minimaxi.com). L'URL est le seul signal qui desambigüise.

Pour les setups ou TOUS les tokens MiniMax sont CN (le cas le plus commun),
le runner a un fallback par defaut : quand un token sk-cp-* est detecte
sans URL explicite, on bascule sur minimax-cn au lieu de minimax (GLOBAL).

Controlable via la variable d'environnement OVERMIND_MINIMAX_DEFAULT :

  OVERMIND_MINIMAX_DEFAULT=cn      (defaut) sk-cp-* sans URL -> minimax-cn
  OVERMIND_MINIMAX_DEFAULT=global            sk-cp-* sans URL -> minimax
  OVERMIND_MINIMAX_DEFAULT=auto              sk-cp-* sans URL -> minimax (no override)

Si ANTHROPIC_BASE_URL est explicite dans les settings, l'URL gagne TOUJOURS
sur OVERMIND_MINIMAX_DEFAULT (le vote 3-signal reste prioritaire).

Pour ton setup actuel (tous les tokens sk-cp-* sont CN), le defaut "cn"
est ce que tu veux. Pas besoin de le set explicitement, mais c'est plus
safe de le mettre dans le .env pour clarifier l'intention.


Comment ça marche en pratique
----------------------------
1. Tu écris un settings_<agent>.json minimal :

   {
     "env": {
       "ANTHROPIC_MODEL": "MiniMax-M3",
       "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN_2",
       "ANTHROPIC_PROVIDER": "minimax-cn",
       "ANTHROPIC_BASE_URL": "https://api.minimaxi.com/anthropic"
     }
   }

2. Overmind (etapes detaillees) :

   a. Lit le settings BRUT (AVANT interpolation des $VAR)
   b. Voit "$ANTHROPIC_AUTH_TOKEN_2" -> le résout depuis process.env
   c. Obtient la valeur du token (ex: "sk-cp-...m0")
   d. SNIFF le préfixe -> détecte "sk-cp-" -> provider = minimax
   e. RECONCILIE 3 signaux (vote par priorite) :
        - token détecté    : minimax  (subtilisation par préfixe)
        - URL du base      : minimax-cn (api.minimaxi.com)
        - settings hint    : minimax-cn (ANTHROPIC_PROVIDER)
      URL gagne (plus specifique que le token)
      -> effectiveProvider = minimax-cn
   f. PRUNE auth.json (enleve les vieux credential_pool entries
      d'autres providers comme zai/minimax qui etaient stales)
   g. ECRIT le .env de l'agent avec les 4 champs canoniques :
        ANTHROPIC_MODEL=MiniMax-M3
        ANTHROPIC_AUTH_TOKEN=***
        ANTHROPIC_PROVIDER=minimax-cn
        ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
      + seed provider-specific (MINIMAX_CN_API_KEY=***
   h. ECRIT auth.json avec le bucket minimax-cn uniquement
      (les autres buckets du fichier sont preserves comme providers
       oauth, mais credential_pool est reset pour eviter le drift)
   i. INVOQUE Hermes qui lit son .env et route vers le bon endpoint


RESOLUTION DES TOKENS (3-pass strategy, NOUVEAU en 2.8.16+)
-----------------------------------------------------------
Quand l'agent a PLUSIEURS clés dans son env (cas fréquent : le user met
plusieurs providers dans Workflow/.env), le runner ne prend plus la première
claire comme avant. Il fait 3 passes :

  Pass 1: settings_<agent>.json env block -> WINS si une clé de token est là
          - Litteral token ("sk-cp-...") -> utilisé tel quel
          - Reference $VAR ("$MINIMAX_CN_API_KEY") -> résolue depuis process.env
            - $VAR introuvable ? FAIL LOUD (throw MISSING_ENV_VAR)
            - On ne fallback PAS silencieusement sur une autre clé

  Pass A: prefer keys whose NAME matches the detected provider
          - Si MINIMAX_API_KEY=*** ET ANTHROPIC_AUTH_TOKEN=*** sont tous les
            deux présents, le user a explicitement mis la provider-specific,
            on respecte son choix -> MINIMAX_API_KEY gagne
          - FIX bug : avant, la 1re clé de TOKEN_KEYS (ANTHROPIC_AUTH_TOKEN)
            gagnait TOUJOURS par re-map, ce qui ecrase silencieusement la
            provider-specific que le user avait set explicitement

  Pass B: re-map la 1re clé vers le bon provider
          - Si seulement ANTHROPIC_AUTH_TOKEN=*** alors on sait que c'est un
            MiniMax (sk-cp-*), on le re-mappe vers MINIMAX_API_KEY

  Pass C: rare, fallback si rien ne match


INTERPOLATION $VAR DANS settings_<agent>.json (FIX BUG)
--------------------------------------------------------
Le runner utilise interpolateEnvVars() (src/lib/envUtils.ts) pour résoudre
les references $VAR et ${VAR} avant d'utiliser les settings.

Bug fixé en 2.8.25 : la regex precedente `\$(\w+)|\${\w+}` avait DEUX bugs :
  (a) Un seul groupe capturant au lieu de deux — ${VAR} causait un crash
      sur process.env[undefined]
  (b) Le } fermant n'etait pas consomme — fuyait comme texte literal

Nouvelle regex : `\$\{(\w+)\}|\$(\w+)` (deux groupes, un par branche,
} consomme).

Exemples :
  "${HOME}"     -> C:\Users\Deamon          (correct, } consomme)
  "$HOME"       -> C:\Users\Deamon          (correct, bare form)
  "sk-${REGION}-x" -> sk-cp-x                (correct, mixed)
  "$$"          -> ""                       (correct, escape not supported)


Ce que tu n'as PAS besoin de faire
----------------------------------
- Tu n'as pas à deviner quel env var name le plugin Hermes attend
- Tu n'as pas à lire plugins/model-providers/minimax/init.py
- Tu n'as pas à mapper manuellement $KEY vers le bon provider
- Tu n'as pas à tester 50 combinaisons d'env var names
- Tu n'as pas à te soucier du cwd du process pour HERMES_HOME

Tu mets ton token, Overmind s'occupe du reste.


HERMES_HOME : résolution déterministe (NOUVEAU en 2.8.27)
---------------------------------------------------------
Le path où Hermes stocke son état (.env, auth.json, sessions, state.db)
est résolu par getAgentHermesHome(agentName) dans src/lib/config.ts.

Ordre de résolution :
  1. $OVERMIND_AGENT_HOME  (env var, set par l'install sudo ou systemd)
  2. <workspace>/.overmind/hermes/agent_<name>/.hermes  (legacy, si existe)
  3. $HOME/.overmind/hermes/agent_<name>/.hermes         (Linux/Mac sudo)
     %LOCALAPPDATA%\overmind\hermes\agent_<name>\.hermes (Windows)
     %USERPROFILE%\overmind\hermes\agent_<name>\.hermes  (Windows fallback)

Pour un agent "sniperbot_analyst" :
  - Dev local:   Workflow\.overmind\hermes\agent_sniperbot_analyst\.hermes
  - Prod Linux:  ~/.overmind/hermes/agent_sniperbot_analyst/.hermes
  - Prod Win:    %LOCALAPPDATA%\overmind\hermes\agent_sniperbot_analyst\.hermes

Pour forcer un path explicite (Docker, deploy custom) :
  export OVERMIND_AGENT_HOME=/var/lib/overmind/hermes

Pour migrer un ancien install (state dans le workspace-relative path) :
  cd "C:/Users/Deamon/Desktop/Backup/Serveur MCP/Workflow"
  node scripts/migrate-hermes-home.mjs --dry-run    # preview
  node scripts/migrate-hermes-home.mjs              # apply


Les 3 signaux que vote Overmind (priorité décroissante)
--------------------------------------------------------
1. PRÉFIXE DU TOKEN   (le plus fiable — c'est la vérité du fournisseur)
2. URL DU BASE        (très fiable — l'API elle-même)
3. ANTHROPIC_PROVIDER (le moins fiable — c'est juste un hint que tu donnes)

Si les 3 ne sont pas d'accord, Overmind LOG un warning explicite
mais utilise le token (signal le plus fiable).
Exception : sk-cp- + URL disambiguent -> l'URL gagne (cf. plus haut).


Si tu donnes une clé foireuse
-----------------------------
- Token sk-cp- mais URL api.z.ai -> warning, mais token wins
  -> Hermes va appeler api.z.ai avec une clé MiniMax -> 401 du provider Z.AI
- Token 32hex.32hex mais provider "minimax" -> warning, mais token wins
  -> Hermes va appeler le plugin zai avec un token Z.AI -> OK

L'erreur 401 finale n'est PAS un bug du runner, c'est le provider
LLM qui rejette la clé (expirée, mauvaise région, etc.).


Comment Hermes obtient la API Key (le vrai flux)
-----------------------------------------------
Le `ANTHROPIC_AUTH_TOKEN` dans `settings.json` NE PASSE PAS DIRECTEMENT
dans le body de la requête API. Hermes utilise son propre credential pool :

  settings_[agent].json
    "env": { "ANTHROPIC_AUTH_TOKEN": "$MINIMAX_CN_API_KEY" }
    ↓ (interpolateEnvVars par NousHermesRunner)
  agentCustomEnv envoyé a Hermes:
    ANTHROPIC_AUTH_TOKEN=***
  Hermes ne lit PAS ANTHROPIC_AUTH_TOKEN directement.
  Hermes lit le CREDENTIAL POOL (auth.json) + les .env vars listees
  dans api_key_env_vars.

  Credential pool est seed par:
    ZAI_ANTHROPIC_FALLBACK_KEY  ->  "zai" avec base_url coding
    Z_AI_API_KEY               ->  "zai" avec base_url non-coding (ancien)
    MINIMAX_CN_API_KEY         ->  "minimax-cn"
    MINIMAX_API_KEY            ->  "minimax" (GLOBAL)

Le $VAR dans ANTHROPIC_AUTH_TOKEN is juste une convenience pour que
le token traverse le runner et arrive dans process.env du subprocess Hermes.
C'est process.env.MINIMAX_CN_API_KEY qui seed le credential pool.


PRUNING auth.json (NOUVEAU en 2.8.27)
--------------------------------------
A chaque run, le runner PRUNE credential_pool dans auth.json pour ne
laisser que les entries du effectiveProvider. Cela evite que Hermes
picke un vieux bucket (ex: zai avec last_status="exhausted") au lieu
du nouveau (ex: minimax-cn fraichement seede).

Le version + les oauth providers sont préservés, seul credential_pool
est re-seedé from scratch.

Symptôme résolu : "Anthropic 401 invalid api key" avec token prefix
correct (sk-cp-...) qui était en fait servi par un vieux credential
zai dans le pool, pas par le nouveau MINIMAX_CN_API_KEY du .env.


Implementation
--------------
La logique de subtilisation vit à deux endroits :

  1. src/services/hermesTokenResolver.ts  (canonique, exporté)
     - Utilisé par les tests unitaires
     - Source de vérité de la stratégie 3-pass

  2. src/services/NousHermesRunner.ts     (closure locale, dans runAgentInternal)
     - Copie miroir de la version canonique, pour ne pas avoir à thread
       5 args (agentName, agentCustomEnv, TOKEN_KEYS, logger, ...) à chaque
       appel
     - DOIT rester sync avec la version canonique

Si les deux divergent, c'est un bug.


Pour résumer en 1 ligne
-----------------------
La subtilisation = Overmind sniffe le préfixe de ton token, vote entre
token/URL/settings pour confirmer, et mappe automatiquement vers le bon
provider et le bon env var, sans que tu aies à configurer le mapping
provider <-> env var toi-même. Le path HERMES_HOME est déterministe,
auth.json est pruné à chaque run, et l'interpolation ${VAR} est robuste.
