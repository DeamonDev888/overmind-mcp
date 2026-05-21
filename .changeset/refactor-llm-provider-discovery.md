---
"overmind-mcp": patch
---

refactor(NousHermesRunner): auto-discovery des providers LLM + documentation Z.AI/MiniMax

**.env reorganisé:**
- Nouvelle section Minimax avec MINIMAX_CN_API_KEY (clé utilisée par provider minimax-cn)
- MINIMAXI_BASE_URL supprimé (inutile — provider minimax-cn hardcode api.minimaxi.com)
- Section Z.AI/GLM documentée: endpoints, tokens, résultats curl (429 vs 200)
- Section "AUTRES" nettoyée: variables résiduelles redistribuées dans leurs sections providers

**NousHermesRunner refactoré:**

GLM/Z.AI (hasGLMKey + bloc z-ai):
- hasGLMKey: refactoré de hardcoded list → auto-discovery par regex sur agentCustomEnv
- Bloc z-ai: documentation complète (endpoint coding plan, priorité URL, priorité clé, modèles supportés)
- Commentaires expliquant pourquoi /paas/v4 → 429 et /coding/paas/v4 → 200

MiniMax (hasMiniMaxKey + bloc minimax-cn):
- hasMiniMaxKey: refactoré de hardcoded ANTHROPIC_AUTH_TOKEN_1-4 → auto-discovery par regex
- Détection: toute variable contenant 'minimax' + suffixe credential (_API_KEY, _AUTH_TOKEN, etc.)
- Bloc minimax-cn: documentation complète (provider, endpoint api.minimaxi.com, modèles MiniMax)
- Clé résolue → injectée dans MINIMAX_CN_API_KEY (lu par provider minimax-cn) + multi-alias pour compatibilité

**Pattern统一的:**
- GLM et MiniMax utilisent maintenant le même pattern auto-discovery par regex
- Z_AI_API_KEY conservé comme fallback legacy dans le scan
- Aucune variable nominale codée en dur (sauf MINIMAX_CN_API_KEY qui est le nom officielle du provider)
