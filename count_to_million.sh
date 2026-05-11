#!/bin/bash

# Script pour compter de 1 à 1,000,000 avec un délai de 0.001s

for ((i=1; i<=1000000; i++)); do
    echo -ne "\r$i"
    sleep 0.001
done

echo ""
echo "Dernier nombre atteint: $i"
