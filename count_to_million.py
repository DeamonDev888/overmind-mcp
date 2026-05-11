#!/usr/bin/env python3
import time

count_to = 1000000
delay = 0.001

for i in range(1, count_to + 1):
    print(f"\r{i}", end="", flush=True)
    time.sleep(delay)

print(f"\nDernier nombre atteint: {i}")
