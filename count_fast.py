#!/usr/bin/env python3
import time
import sys

count_to = 1000000
delay = 0.001
start = time.time()

for i in range(1, count_to + 1):
    # Affichage silencieux (pas de sortie pour éviter de saturer la mémoire)
    time.sleep(delay)

end = time.time()
elapsed = end - start

print(f"\n✓ Comptage terminé!")
print(f"Dernier nombre atteint: {i}")
print(f"Temps total: {elapsed:.2f} secondes ({elapsed/60:.2f} minutes)")
