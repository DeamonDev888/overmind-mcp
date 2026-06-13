#!/usr/bin/env python3
"""
gen_evm_key_retro.py — Générateur de clés privées EVM style KEYGEN des années 2000.
Dimensions verrouillées : 500x360 pixels.
Thème visuel : Ville Overmind en parallaxe sur 3 couches, route perspective 3D animée, scanlines CRT.
Thème sonore : Syntheur Chiptune basse fréquence sans aucun aigu strident (style Mephisto Attack).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import struct
import sys
import threading
import time
from typing import Any

# =========================================================================
# SYSTEME DE GENERATION DE CLES CRYPTOGRAPHIQUES EVM (EIP-55 Checksum)
# =========================================================================
try:
    # eth_account utilise le CSPRNG du système d'exploitation sous le capot
    from eth_account import Account
except ImportError:
    sys.stderr.write("Erreur : le module 'eth-account' est manquant.\n")
    sys.stderr.write("Veuillez l'installer avec : pip install eth-account\n")
    sys.exit(1)


def gen_one(no_0x: bool = False) -> dict[str, str]:
    """
    Génère une clé privée de 32 octets via un générateur pseudo-aléatoire cryptographiquement sûr.
    Dérive ensuite l'adresse publique Ethereum avec le checksum conforme à la norme EIP-55.
    
    Args:
        no_0x (bool): Si True, la clé privée sera retournée sans le préfixe '0x'.
        
    Returns:
        dict[str, str]: Contient la clé privée sous 'private_key' et l'adresse sous 'address'.
    """
    # Création d'un compte éphémère sécurisé
    acct = Account.create()
    priv = acct.key.hex()
    if not no_0x:
        priv = "0x" + priv
    return {"private_key": priv, "address": acct.address}


# Détection de la disponibilité de l'interface graphique Tkinter
GUI_AVAILABLE = False
try:
    import tkinter as tk
    from tkinter import font as tkfont
    GUI_AVAILABLE = True
except ImportError:
    pass

# Détection de la compatibilité audio Windows
WINSOUND_AVAILABLE = False
if sys.platform == "win32":
    try:
        import winsound
        WINSOUND_AVAILABLE = True
    except ImportError:
        pass


# =========================================================================
# CHIPTUNE SYNTH — Moteur Audio Basse Fréquence (Anti-Aigu & Anti-Clics)
# =========================================================================
class ChiptuneSynth:
    """
    Générateur de musique chiptune rétro 8-bit mono à 22 050 Hz.
    Toutes les notes ont été transposées d'une octave supplémentaire vers le bas (40 Hz - 130 Hz)
    afin d'éliminer toute fréquence aiguë ou stridence agaçante pour l'utilisateur.
    Le signal utilise une enveloppe linéaire d'attaque et de relâchement pour éviter les bruits de clic.
    """

    SAMPLE_RATE = 22050  # Fréquence d'échantillonnage standard chiptune

    def __init__(self) -> None:
        self.playing = False
        self.temp_file = None
        self.wav_data: bytes | None = None
        self._generate_wav()  # Prégénération du signal en mémoire pour un chargement instantané

    def _generate_wav(self) -> None:
        """
        Génère les échantillons PCM 16-bit et construit le conteneur binaire au format RIFF/WAVE.
        La structure de la chanson comprend : Couplet x2 -> Refrain x2 -> Couplet x1 -> Pont x1 -> Refrain x2.

        Nettoie aussi tout fichier temporaire orphelin laissé par une session crashée précédente.
        """
        import io

        # --- Purge fichier temporaire orphelin d'une session précédente crashée ---
        try:
            import tempfile
            _orphan = os.path.join(tempfile.gettempdir(), "overmind_keygen_music.wav")
            if os.path.exists(_orphan):
                os.remove(_orphan)
        except Exception:
            pass
        
        # Fréquences transposées très bas (basse lourde et chaude)
        # 1. Couplet (Riff sombre et rapide en E-Phrygien)
        verse = [
            41.20, 41.20, 43.65, 41.20, 49.00, 43.65, 41.20, 43.65,
            41.20, 41.20, 61.74, 55.00, 49.00, 43.65, 41.20, 43.65
        ]
        
        # 2. Refrain (Ligne mélodique plus présente et enveloppante)
        chorus = [
            55.00, 65.41, 82.41, 110.00, 98.00, 82.41, 87.31, 73.42,
            55.00, 65.41, 82.41, 110.00, 123.47, 130.81, 110.00, 98.00
        ]
        
        # 3. Pont (Pulsations lourdes de sub-basse)
        bridge = [
            32.70, 32.70, 41.20, 32.70, 36.71, 36.71, 43.65, 36.71,
            49.00, 49.00, 55.00, 49.00, 55.00, 55.00, 65.41, 55.00
        ]
        
        # Assemblage structurel de la boucle audio
        melody = verse * 2 + chorus * 2 + verse + bridge + chorus * 2
        
        note_duration = 0.09  # Durée de 90ms par note (rythme rapide d'arpégiateur)
        samples_per_note = int(self.SAMPLE_RATE * note_duration)
        
        data = []
        for freq in melody:
            for i in range(samples_per_note):
                t = i / self.SAMPLE_RATE
                # Génération de l'onde sinusoïdale pure (plus douce que les ondes carrées)
                val = math.sin(2 * math.pi * freq * t)
                
                # Enveloppe ADSR simplifiée (Attaque de 15% et Relâchement de 25%) pour supprimer les clics
                envelope = 1.0
                fade_in_samples = int(samples_per_note * 0.15)
                fade_out_samples = int(samples_per_note * 0.25)
                
                if i < fade_in_samples:
                    envelope = i / fade_in_samples
                elif i > (samples_per_note - fade_out_samples):
                    envelope = (samples_per_note - i) / fade_out_samples
                
                # Amplitude calibrée à 6% maximum pour rester une musique d'ambiance très discrète
                val_scaled = int(val * 32767 * 0.06 * envelope)
                data.append(val_scaled)

        # En-tête standard du format audio WAVE (PCM 16-bit Mono)
        num_samples = len(data)
        data_bytes = struct.pack(f"<{num_samples}h", *data)
        byte_rate = self.SAMPLE_RATE * 2
        data_size = num_samples * 2
        
        buffer = io.BytesIO()
        buffer.write(b"RIFF")
        buffer.write(struct.pack("<I", 36 + data_size))
        buffer.write(b"WAVEfmt ")
        buffer.write(struct.pack("<IHHIIHH", 16, 1, 1, self.SAMPLE_RATE, byte_rate, 2, 16))
        buffer.write(b"data")
        buffer.write(struct.pack("<I", data_size))
        buffer.write(data_bytes)
        self.wav_data = buffer.getvalue()

    def start(self) -> None:
        """Démarre la lecture asynchrone de la musique en boucle depuis un fichier temporaire."""
        if not WINSOUND_AVAILABLE or not self.wav_data:
            return
        self.playing = True
        try:
            import tempfile
            # Écriture du buffer binaire sur le disque pour contourner les limitations SND_MEMORY de Windows
            self.temp_file = os.path.join(tempfile.gettempdir(), "overmind_keygen_music.wav")
            with open(self.temp_file, "wb") as f:
                f.write(self.wav_data)
            # Lecture asynchrone en boucle infinie
            winsound.PlaySound(self.temp_file, winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_LOOP)
        except Exception:
            pass

    def stop(self) -> None:
        """Arrête la musique et supprime proprement le fichier WAV temporaire."""
        self.playing = False
        if WINSOUND_AVAILABLE:
            try:
                winsound.PlaySound(None, winsound.SND_PURGE)
                if self.temp_file and os.path.exists(self.temp_file):
                    os.remove(self.temp_file)
            except Exception:
                pass

    def toggle(self) -> bool:
        """Bascule entre la lecture et la mise en pause."""
        if self.playing:
            self.stop()
            return False
        self.start()
        return True

    def reveal_beep(self) -> None:
        """Génère un signal sonore de transition grave/médium doux lors du reveal de la clé."""
        if not WINSOUND_AVAILABLE:
            return
        try:
            # Balayage fréquentiel grave (120 Hz à 240 Hz) pour éviter tout sifflement strident
            sps = int(self.SAMPLE_RATE * 0.18)
            raw = bytearray()
            for i in range(sps):
                t = i / self.SAMPLE_RATE
                f = 120.0 + (240.0 - 120.0) * (i / sps)
                val = math.sin(2 * math.pi * f * t)
                env = 1.0 - (i / sps) * 0.8
                v = int(val * 127 * 0.3 * env)
                raw.append((v + 128) & 0xFF)

            data_size = len(raw)
            buf = bytearray()
            buf += b"RIFF"
            buf += struct.pack("<I", 36 + data_size)
            buf += b"WAVEfmt "
            buf += struct.pack("<IHHIIHH", 16, 1, 1, self.SAMPLE_RATE, self.SAMPLE_RATE, 1, 8)
            buf += b"data"
            buf += struct.pack("<I", data_size)
            buf += raw
            winsound.PlaySound(bytes(buf), winsound.SND_MEMORY | winsound.SND_ASYNC)
        except Exception:
            pass


# =========================================================================
# APPLICATION GRAPHIQUE Retro Keygen 2000 (Tkinter)
# =========================================================================
class KeygenApp:
    # Palette de couleurs Cyberpunk néon
    BG_DEEP = "#000000"
    BG_PANEL = "#07070d"
    BG_TITLE = "#0f0f15"
    FG_GREEN = "#00ff41"
    FG_CYAN = "#00ffff"
    FG_MAG = "#ff00ff"
    FG_YEL = "#ffff00"
    FG_RED = "#ff0055"

    # Dimensions fixes obligatoires du Keygen
    W = 500
    H = 360
    CANVAS_H = 216  # Hauteur dédiée à la scène graphique animée

    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("OVERMIND BEARER KEYGEN 2000")
        self.root.configure(bg=self.BG_DEEP)
        self.root.resizable(False, False)

        # Mode Borderless (pas de bordures système Windows)
        self.root.overrideredirect(True)
        sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
        x, y = (sw - self.W) // 2, (sh - self.H) // 2
        self.root.geometry(f"{self.W}x{self.H}+{x}+{y}")

        # Variables pour permettre le déplacement (drag & drop) de la fenêtre
        self._drag_x: int | None = None
        self._drag_y: int | None = None
        root.bind("<ButtonPress-1>", self._on_press)
        root.bind("<ButtonRelease-1>", self._on_release)
        root.bind("<B1-Motion>", self._on_motion)
        
        # Raccourcis clavier (Échap pour quitter, F1 pour générer)
        root.bind("<Escape>", lambda e: self._close())
        root.bind("<F1>", lambda e: self._start_generation())

        # Variables d'état des animations
        self.grid_offset = 0.0
        self.traffic_offset = 0.0
        self.scan_y = 0
        self.stars: list[dict[str, Any]] = []
        
        # ---------------------------------------------------------------------
        # DESIGN DE LA SCENE URBAINE DE LA VILLE EN PARALLAXE (3 COUCHES)
        # ---------------------------------------------------------------------
        
        # 1. COUCHE ARRIÈRE-PLAN (Lente, silhouettes très sombres)
        # Défilement : -0.07px par frame
        self.buildings_far = [
            {"x": 10.0, "w": 60, "h": 160, "col": "#0b0417"},
            {"x": 100.0, "w": 75, "h": 140, "col": "#05081f"},
            {"x": 200.0, "w": 55, "h": 170, "col": "#0b0417"},
            {"x": 290.0, "w": 80, "h": 150, "col": "#05081f"},
            {"x": 390.0, "w": 65, "h": 165, "col": "#0b0417"},
            {"x": 480.0, "w": 70, "h": 135, "col": "#05081f"}
        ]
        
        # 2. COUCHE INTERMÉDIAIRE (Vitesse moyenne, immeubles filaires mauves)
        # Défilement : -0.18px par frame
        self.buildings_mid = [
            {"x": 30.0, "w": 45, "h": 115, "col": "#1f0933", "roof": 1},
            {"x": 110.0, "w": 55, "h": 135, "col": "#101647", "roof": 0},
            {"x": 210.0, "w": 50, "h": 120, "col": "#1f0933", "roof": 3},
            {"x": 310.0, "w": 60, "h": 145, "col": "#101647", "roof": 1},
            {"x": 410.0, "w": 45, "h": 125, "col": "#1f0933", "roof": 0}
        ]
        
        # 3. COUCHE PREMIER PLAN (Rapide, détails néons, antennes, panneaux publicitaires)
        # Défilement : -0.48px par frame
        # types de toit (roof): 0=plat, 1=escalier, 2=antenne + feu de signalisation, 3=dôme, 4=double flèche
        self.buildings_fg = [
            {"x": 5.0, "w": 40, "h": 90, "col": "#b800b8", "roof": 2, "sign": "OVR"},
            {"x": 65.0, "w": 30, "h": 120, "col": "#0055ff", "roof": 0, "sign": ""},
            {"x": 115.0, "w": 35, "h": 75, "col": "#5a00bd", "roof": 1, "sign": ""},
            {"x": 170.0, "w": 45, "h": 135, "col": "#ff00ff", "roof": 4, "sign": "EVM"},
            {"x": 235.0, "w": 30, "h": 85, "col": "#0088ff", "roof": 0, "sign": ""},
            {"x": 285.0, "w": 35, "h": 110, "col": "#00ffcc", "roof": 3, "sign": "SYS"},
            {"x": 340.0, "w": 40, "h": 130, "col": "#990099", "roof": 2, "sign": ""},
            {"x": 400.0, "w": 45, "h": 115, "col": "#00ff99", "roof": 1, "sign": ""},
            {"x": 465.0, "w": 35, "h": 80, "col": "#0055ff", "roof": 0, "sign": ""}
        ]

        self.current_key: dict[str, str] | None = None

        # --- Splash LOADING style keygen 2000 (1.5s) ---
        self._splash_start = time.time()
        self._splash_label: tk.Label | None = None
        self._splash_bar: int = 0

        self._build_ui()
        self._show_splash()
        
        # Génération aléatoire d'un champ d'étoiles colorées et scintillantes
        for _ in range(40):
            self.stars.append({
                "x": random.randint(2, self.W - 2),
                "y": random.randint(2, 128),
                "color": random.choice(["#ffffff", "#00ffff", "#ff00ff", "#8888aa"]),
                "size": random.choice([1, 2])
            })

        # Initialisation et lecture de la musique
        self.synth = ChiptuneSynth()
        self.synth.start()

        # Démarrage des boucles temporelles d'animation Tkinter
        self._tick_city()
        self._tick_glitch()

    # Event Handlers pour le déplacement sans bordure de la fenêtre
    def _on_press(self, e):
        self._drag_x = e.x
        self._drag_y = e.y

    def _on_release(self, e):
        self._drag_x = None
        self._drag_y = None

    def _on_motion(self, e):
        if self._drag_x is None:
            return
        dx = e.x - self._drag_x
        dy = e.y - self._drag_y
        self.root.geometry(f"+{self.root.winfo_x() + dx}+{self.root.winfo_y() + dy}")

    def _tick_city(self) -> None:
        """Dessine et anime l'ensemble de la scène graphique néon de façon synchrone."""
        self.canvas_bg.delete("all")
        
        horizon_y = 130
        max_y = self.CANVAS_H
        
        # 1. ÉTOILES SCINTILLANTES
        for star in self.stars:
            # Twinkle discret par variation d'intensité aléatoire
            color = star["color"]
            if random.random() < 0.08:
                color = random.choice(["#333344", "#555566", star["color"]])
            
            s = star["size"]
            self.canvas_bg.create_oval(
                star["x"], star["y"], star["x"] + s, star["y"] + s,
                fill=color, outline=""
            )

        # 2. SILHOUETTES URBAINES D'ARRIÈRE-PLAN (COUCHE 1 - LENTE)
        for b in self.buildings_far:
            b["x"] -= 0.07
            if b["x"] + b["w"] < 0:
                b["x"] = self.W
            
            x, w, h, col = b["x"], b["w"], b["h"], b["col"]
            top_y = horizon_y - h
            # Rectangle plein avec bordure wireframe très sombre
            self.canvas_bg.create_rectangle(
                x, top_y, x + w, horizon_y,
                fill="#020006", outline=col, width=1
            )

        # 3. IMMEUBLES DE COUCHE INTERMÉDIAIRE (COUCHE 2 - MOYENNE)
        for b in self.buildings_mid:
            b["x"] -= 0.18
            if b["x"] + b["w"] < 0:
                b["x"] = self.W
            
            x, w, h, col, roof = b["x"], b["w"], b["h"], b["col"], b["roof"]
            top_y = horizon_y - h
            
            # Dessin de l'immeuble de base
            self.canvas_bg.create_rectangle(x, top_y, x + w, horizon_y, fill="#04000b", outline=col, width=1)
            
            # Structures architecturales supplémentaires sur le toit
            if roof == 1:  # Stepped/Escalier
                self.canvas_bg.create_rectangle(x + 5, top_y - 6, x + w - 5, top_y, fill="#04000b", outline=col, width=1)
            elif roof == 3:  # Dome/Coupole
                self.canvas_bg.create_arc(x + 6, top_y - 12, x + w - 6, top_y + 4, start=0, extent=180, fill="#04000b", outline=col, width=1)

        # 4. IMMEUBLES DU PREMIER PLAN DETAILLES (COUCHE 3 - RAPIDE)
        for b in self.buildings_fg:
            b["x"] -= 0.48
            if b["x"] + b["w"] < 0:
                b["x"] = self.W
                
            x, w, h, col, roof = b["x"], b["w"], b["h"], b["col"], b["roof"]
            sign = b.get("sign", "")
            top_y = horizon_y - h
            
            # Structure du toit de premier plan
            if roof == 1:  # Toit en escalier
                self.canvas_bg.create_rectangle(x, top_y, x + w, horizon_y, fill="#060012", outline=col, width=1.5)
                self.canvas_bg.create_rectangle(x + 4, top_y - 5, x + w - 4, top_y, fill="#060012", outline=col, width=1.5)
                self.canvas_bg.create_rectangle(x + 8, top_y - 10, x + w - 8, top_y - 5, fill="#060012", outline=col, width=1.5)
            elif roof == 2:  # Toit avec mât et feu rouge clignotant
                self.canvas_bg.create_rectangle(x, top_y, x + w, horizon_y, fill="#060012", outline=col, width=1.5)
                cx = x + w // 2
                self.canvas_bg.create_line(cx, top_y, cx, top_y - 15, fill=col, width=1.5)
                # Clignotement du voyant de sécurité
                flash_col = "#ff0000" if (int(time.time() * 3.5) % 2 == 0) else "#440000"
                self.canvas_bg.create_oval(cx - 2.5, top_y - 17.5, cx + 2.5, top_y - 12.5, fill=flash_col, outline="")
            elif roof == 3:  # Coupole
                self.canvas_bg.create_rectangle(x, top_y, x + w, horizon_y, fill="#060012", outline=col, width=1.5)
                self.canvas_bg.create_arc(x + 4, top_y - 14, x + w - 4, top_y + 2, start=0, extent=180, fill="#060012", outline=col, width=1.5)
            elif roof == 4:  # Deux antennes / flèches
                self.canvas_bg.create_rectangle(x, top_y, x + w, horizon_y, fill="#060012", outline=col, width=1.5)
                self.canvas_bg.create_line(x + 6, top_y, x + 6, top_y - 12, fill=col, width=1.2)
                self.canvas_bg.create_line(x + w - 6, top_y, x + w - 6, top_y - 12, fill=col, width=1.2)
                # Feux de signalisation alternés
                f1_col = "#ff0000" if (int(time.time() * 3) % 2 == 0) else "#440000"
                f2_col = "#440000" if (int(time.time() * 3) % 2 == 0) else "#ff0000"
                self.canvas_bg.create_oval(x + 4, top_y - 14, x + 8, top_y - 10, fill=f1_col, outline="")
                self.canvas_bg.create_oval(x + w - 8, top_y - 14, x + w - 4, top_y - 10, fill=f2_col, outline="")
            else:  # Toit plat simple
                self.canvas_bg.create_rectangle(x, top_y, x + w, horizon_y, fill="#060012", outline=col, width=1.5)
                
            # Dessin des enseignes néons lumineuses publicitaires
            if sign:
                # Plaque de fond néon
                self.canvas_bg.create_rectangle(
                    x + w//2 - 14, top_y + 12, x + w//2 + 14, top_y + 24,
                    fill="#000000", outline=self.FG_CYAN if sign == "SYS" else self.FG_MAG, width=1
                )
                self.canvas_bg.create_text(
                    x + w//2, top_y + 18, text=sign,
                    fill=self.FG_CYAN if sign == "SYS" else self.FG_MAG,
                    font=("Courier", 8, "bold")
                )

            # Fenêtres éclairées de façon dynamique à l'aide d'un PRNG déterministe basé sur l'abscisse
            random.seed(int(x) + 400)
            cols = w // 8
            rows = h // 11
            for r in range(1, rows):
                for c in range(1, cols):
                    # Taux de fenêtres allumées (40%)
                    if random.random() < 0.40:
                        win_x = x + c * 8
                        win_y = top_y + r * 11
                        # Variantes de couleurs chaudes de fenêtres rétro
                        win_c = random.choice(["#ffff55", "#ffaa00", "#ffffff"])
                        self.canvas_bg.create_rectangle(
                            win_x, win_y, win_x + 2, win_y + 2,
                            fill=win_c, outline=""
                        )

        # 5. ROUTE HIGHWAY PERSPECTIVE 3D ET TRAFFIC D'IMPULSION
        # Ligne d'horizon néon magenta
        self.canvas_bg.create_line(0, horizon_y, self.W, horizon_y, fill="#ff00ff", width=2)
        
        # Dessin des lignes de fuite verticales (Perspective radiale)
        for i in range(-12, 13):
            self.canvas_bg.create_line(250 + i * 6, horizon_y, 250 + i * 45, max_y, fill="#003c55", width=1)
            
        # Lignes d'horizon horizontales qui se rapprochent et s'accélèrent vers le bas (effet tunnel)
        # L'incrément oscille entre 1.2 et 3.5 pour simuler des cycles d'accélération/décélération
        if not hasattr(self, "_grid_speed"):
            self._grid_speed = 1.2
            self._grid_dir = 1
        # Bascule de direction aux bornes pour rester dans une plage visuelle stable
        if self._grid_speed >= 3.5:
            self._grid_dir = -1
        elif self._grid_speed <= 1.2:
            self._grid_dir = 1
        self._grid_speed += 0.012 * self._grid_dir
        self.grid_offset = (self.grid_offset + self._grid_speed) % 12
        y_lines = [130, 133, 137, 143, 152, 165, 183, 208, 240]
        for idx, y in enumerate(y_lines[:-1]):
            next_y = y_lines[idx+1]
            interpolated_y = y + (next_y - y) * (self.grid_offset / 12.0)
            if interpolated_y <= max_y:
                self.canvas_bg.create_line(0, interpolated_y, self.W, interpolated_y, fill="#007799", width=1)

        # Animation des flux de trafic néon (les "voitures" ou paquets binaires)
        self.traffic_offset = (self.traffic_offset + 0.035) % 1.0
        # Les véhicules se déplacent sur les voies clés du réseau routier virtuel
        for lane_idx in [-5, -2, 2, 5]:
            for car_p in range(3):
                p = (self.traffic_offset + car_p / 3.0) % 1.0
                p_curved = p * p  # Distorsion quadratique perspective correcte
                
                y_p = horizon_y + p_curved * (max_y - horizon_y)
                x_p = 250 + lane_idx * (6 + p_curved * 39)
                
                # Taille proportionnelle à la proximité de la caméra
                size = 1 + p_curved * 4.5
                color = self.FG_CYAN if lane_idx > 0 else self.FG_MAG
                
                self.canvas_bg.create_rectangle(
                    x_p - size, y_p - size/2.5, x_p + size, y_p + size/2.5,
                    fill=color, outline=""
                )


        # 6. FILTRE CRT ET EFFET SCANLINE BALAYAGE VISUEL
        self.scan_y = (self.scan_y + 3) % (self.H + 80)
        self.canvas_bg.create_rectangle(
            0, self.scan_y - 20, self.W, self.scan_y,
            fill=self.FG_GREEN, stipple="gray12", outline=""
        )
        
        # Quadrillage de lignes horizontales d'interfaçage moniteur cathodique
        for y in range(0, self.CANVAS_H, 3):
            self.canvas_bg.create_line(0, y, self.W, y, fill="#010a05")

        # Prochain rafraîchissement d'affichage (~30 FPS)
        self.root.after(33, self._tick_city)

    def _tick_glitch(self) -> None:
        """Gère les micro-glitchs textuels et clignotements chromatiques du titre du Keygen."""
        try:
            colors = [self.FG_GREEN, self.FG_CYAN, self.FG_MAG, self.FG_YEL, self.FG_RED]
            self.title_lbl.config(fg=random.choice(colors))
            t = "🚀  OVERMIND BEARER KEYGEN 2 0 0 0  🚀"
            # Une chance sur quatre d'avoir un caractère altéré/cryptique temporaire
            if random.random() < 0.25:
                idx = random.randint(0, len(t) - 1)
                t = t[:idx] + random.choice("█▓▒░*#@&$") + t[idx + 1:]
            self.title_lbl.config(text=t)
        except Exception:
            pass
        self.root.after(160, self._tick_glitch)

    def _build_ui(self) -> None:
        """Initialise, positionne et configure tous les widgets Tkinter de l'application."""
        # Canvas principal recevant le rendu de la ville
        self.canvas_bg = tk.Canvas(
            self.root, width=self.W, height=self.CANVAS_H,
            bg="#020005", highlightthickness=0, bd=0
        )
        self.canvas_bg.place(x=0, y=26)

        # Barre de titre supérieure permettant de faire glisser la fenêtre borderless
        title_bar = tk.Frame(self.root, bg=self.BG_TITLE, height=26)
        title_bar.place(x=0, y=0, width=self.W, height=26)
        title_bar.bind("<ButtonPress-1>", self._on_press)
        title_bar.bind("<ButtonRelease-1>", self._on_release)
        title_bar.bind("<B1-Motion>", self._on_motion)

        self.title_lbl = tk.Label(
            title_bar, text="🚀  OVERMIND BEARER KEYGEN 2 0 0 0  🚀",
            fg=self.FG_GREEN, bg=self.BG_TITLE,
            font=("Courier", 11, "bold"),
        )
        self.title_lbl.pack(side="left", padx=8)

        # Bouton Fermer [X]
        close_btn = tk.Button(
            self.root, text="[X]", command=self._close,
            fg=self.FG_RED, bg=self.BG_TITLE,
            activeforeground="#ffffff", activebackground="#660000",
            bd=1, relief="raised",
            font=("Courier", 10, "bold"),
            width=4, cursor="hand2",
        )
        close_btn.place(x=self.W - 38, y=2)

        # Ruban de texte défilant de pied de scène (Marquee)
        self.marquee_text = "   *** OVERMIND BEARER KEYGEN v1.0 *** CRAFTED BY DEMON-CORP *** FORGE YOUR KEY SECURELY *** FOR OVERMIND BEARER USE *** GREETZ TO ALL CO-AGENTS IN THE GRID ***   "
        self.foot_lbl = tk.Label(
            self.root,
            text=self.marquee_text,
            fg=self.FG_MAG, bg=self.BG_DEEP,
            font=("Courier", 8, "bold")
        )
        self.foot_lbl.place(x=10, y=243)

        # Zone d'affichage des clés générées (Formulaire enclavé)
        self.key_frame = tk.Frame(self.root, bg=self.BG_PANEL, bd=1, relief="sunken")
        self.key_frame.place(x=10, y=264, width=self.W - 20, height=52)
        self.key_frame.columnconfigure(1, weight=1)

        # Label et Entry de l'Adresse Ethereum
        tk.Label(self.key_frame, text="ADDRESS:", fg=self.FG_CYAN, bg=self.BG_PANEL, font=("Courier", 8, "bold")).grid(row=0, column=0, sticky="w", padx=5, pady=2)
        self.addr_var = tk.StringVar(value="0x........................................")
        self.addr_entry = tk.Entry(self.key_frame, textvariable=self.addr_var, fg=self.FG_GREEN, bg="#050a06", insertbackground=self.FG_GREEN, font=("Courier", 8, "bold"), bd=1, width=52)
        self.addr_entry.grid(row=0, column=1, padx=5, pady=2, sticky="ew")
        self.addr_entry.config(state="readonly")

        # Label et Entry de la Clé Privée (Verrouillée en Cyan `#00ffff` sur fond sombre)
        tk.Label(self.key_frame, text="PRIVATE:", fg=self.FG_CYAN, bg=self.BG_PANEL, font=("Courier", 8, "bold")).grid(row=1, column=0, sticky="w", padx=5, pady=2)
        self.priv_var = tk.StringVar(value="")
        self.priv_entry = tk.Entry(self.key_frame, textvariable=self.priv_var, fg=self.FG_CYAN, bg="#050a0a", insertbackground=self.FG_CYAN, font=("Courier", 8, "bold"), bd=1, show="*", width=52)
        self.priv_entry.grid(row=1, column=1, padx=5, pady=2, sticky="ew")
        self.priv_entry.config(state="readonly")

        # Conteneur des boutons d'actions inférieurs
        btn_frame = tk.Frame(self.root, bg=self.BG_DEEP)
        btn_frame.place(x=10, y=320)

        # Usine à boutons stylisés
        def btn(parent, text, cmd, fg=None, width=15):
            return tk.Button(
                parent, text=text, command=cmd,
                fg=fg or self.FG_GREEN, bg=self.BG_TITLE,
                activeforeground="#ffffff", activebackground="#333333",
                bd=2, relief="raised",
                font=("Courier", 10, "bold"),
                width=width, padx=6, pady=4,
                cursor="hand2",
            )

        self.gen_btn = btn(btn_frame, "[ GENERATE ]", self._start_generation)
        self.gen_btn.pack(side="left", padx=5)

        self.copy_btn = btn(btn_frame, "[ COPY PRIVATE ]", self._copy_private, fg="#ffcc00")
        self.copy_btn.pack(side="left", padx=5)
        self.copy_btn.config(state="disabled")

        self.music_btn = btn(btn_frame, "[ MUSIC: ON ]", self._toggle_music, fg=self.FG_GREEN)
        self.music_btn.pack(side="left", padx=5)

    def _show_splash(self) -> None:
        """Affiche un écran de chargement rétro 'LOADING OVERMIND OS...' pendant 1.5s."""
        # Overlay plein écran sur le canvas de scène
        self._splash_overlay = tk.Frame(self.root, bg="#000000", bd=2, relief="ridge",
                                        highlightthickness=2, highlightbackground=self.FG_CYAN)
        self._splash_overlay.place(x=4, y=30, width=self.W - 8, height=self.CANVAS_H - 8)

        tk.Label(
            self._splash_overlay, text=">>> LOADING OVERMIND OS v1.0 <<<",
            fg=self.FG_GREEN, bg="#000000",
            font=("Courier", 10, "bold"),
        ).pack(pady=(40, 8))

        # Progress bar textuelle
        self._splash_bar_lbl = tk.Label(
            self._splash_overlay, text="[                    ]  0%",
            fg=self.FG_YEL, bg="#000000",
            font=("Courier", 10, "bold"),
        )
        self._splash_bar_lbl.pack(pady=4)

        tk.Label(
            self._splash_overlay, text="Mounting entropy pool...",
            fg=self.FG_MAG, bg="#000000",
            font=("Courier", 8, "bold"),
        ).pack(pady=(20, 0))

        # Démarre l'animation de la progress bar
        self._update_splash(0)

    def _update_splash(self, pct: int) -> None:
        """Avance la jauge LOADING et détruit l'overlay à 100%."""
        try:
            bar = "[" + "█" * (pct // 5) + " " * (20 - pct // 5) + "]"
            self._splash_bar_lbl.config(text=f"{bar}  {pct:3d}%")
        except Exception:
            return
        if pct >= 100:
            # Splash terminé -> on retire l'overlay
            try:
                self._splash_overlay.destroy()
            except Exception:
                pass
            return
        self.root.after(30, self._update_splash, pct + 2)

    def _glitch_rgb_shift(self) -> None:
        """Effet VHS : décale temporairement les couleurs de l'overlay frame pendant 150ms."""
        try:
            # On crée 3 copies translatées du canvas de scène en R/G/B (effet chromatisme)
            w, h = self.W, self.CANVAS_H
            # 3 lignes fines de couleurs pures qui flashent (simule un shift RGB discret)
            self.canvas_bg.create_rectangle(2, 0, w, 3, fill="#ff0000", stipple="gray25", outline="", tags="rgb")
            self.canvas_bg.create_rectangle(-2, 0, w - 4, 3, fill="#00ff00", stipple="gray25", outline="", tags="rgb")
            self.canvas_bg.create_rectangle(0, 0, w, 3, fill="#0000ff", stipple="gray25", outline="", tags="rgb")
            # Auto-cleanup
            self.root.after(150, lambda: self.canvas_bg.delete("rgb"))
        except Exception:
            pass

    def _start_generation(self) -> None:
        """Déclenche la routine asynchrone de génération et de reveal de la paire de clés."""
        if self.gen_btn.cget("state") == "disabled":
            return
        self.gen_btn.config(state="disabled")
        self.copy_btn.config(state="disabled")
        self.priv_var.set("")
        self.addr_var.set("0x" + "•" * 40)
        t = threading.Thread(target=self._scan_then_reveal, daemon=True)
        t.start()

    def _scan_then_reveal(self) -> None:
        """Génère la clé, joue le signal sonore basse-fréquence, et révèle les caractères l'un après l'autre."""
        try:
            key = gen_one()
        except Exception:
            self.root.after(0, lambda: self.gen_btn.config(state="normal"))
            return

        self.current_key = key
        addr = key["address"]
        priv = key["private_key"]

        # Signal de transition sonore non strident
        self.synth.reveal_beep()

        # Révélation progressive de l'Adresse
        for i in range(len(addr)):
            shown = addr[: i + 1] + "•" * (len(addr) - i - 1)
            self.root.after(0, lambda s=shown: self.addr_var.set(s))
            time.sleep(0.015)
        self.root.after(0, lambda: self.addr_var.set(addr))

        # Flash lumineux d'impact rétro sur le canvas
        self.root.after(0, self._flash)
        # Glitch VHS (décalage RGB) qui accompagne le reveal
        self.root.after(0, self._glitch_rgb_shift)

        # Révélation progressive de la Clé Privée
        for i in range(len(priv)):
            shown = priv[: i + 1] + "•" * (len(priv) - i - 1)
            self.root.after(0, lambda s=shown: self.priv_var.set(s))
            time.sleep(0.02)

        # Déverrouillage des boutons d'actions
        self.root.after(0, lambda: self.gen_btn.config(state="normal"))
        self.root.after(0, lambda: self.copy_btn.config(state="normal"))

    def _flash(self) -> None:
        """Crée un flash lumineux stroboscopique vert transparent d'une fraction de seconde."""
        fl = self.canvas_bg.create_rectangle(
            0, 0, self.W, self.CANVAS_H, fill=self.FG_GREEN, stipple="gray12", outline=""
        )
        self.root.after(120, lambda: self.canvas_bg.delete(fl))

    def _copy_private(self) -> None:
        """Copie la paire {address, private_key} en JSON dans le presse-papiers système.

        Format: {"address":"0x...","private_key":"0x..."}  (une seule ligne, prêt à coller).
        """
        if not self.current_key:
            return
        # JSON une ligne, séparateurs serrés, prêt à coller dans un autre outil
        payload = json.dumps(
            {"address": self.current_key["address"],
             "private_key": self.current_key["private_key"]},
            separators=(",", ":"),
        )
        try:
            self.root.clipboard_clear()
            self.root.clipboard_append(payload)
            self.root.update()
        except Exception:
            pass
        # Feedback visuel temporaire sur le bouton
        orig = "[ COPY PRIVATE ]"
        self.copy_btn.config(text="[ COPIED! ]", fg=self.FG_GREEN)
        self.root.after(1500, lambda: self.copy_btn.config(text=orig, fg="#ffcc00"))

    def _toggle_music(self) -> None:
        """Active/Désactive la lecture du module chiptune de fond."""
        playing = self.synth.toggle()
        if playing:
            self.music_btn.config(text="[ MUSIC: ON ]", fg=self.FG_GREEN)
        else:
            self.music_btn.config(text="[ MUSIC: OFF ]", fg=self.FG_RED)

    def start_marquee(self) -> None:
        """Démarre le fil de texte défilant dans un thread autonome."""
        def scroll():
            text = self.marquee_text
            while True:
                try:
                    text = text[1:] + text[0]
                    self.foot_lbl.config(text=text)
                    time.sleep(0.1)
                except Exception:
                    break
        t = threading.Thread(target=scroll, daemon=True)
        t.start()

    def _close(self) -> None:
        """Stoppe les audios et détruit la fenêtre Tkinter pour quitter proprement."""
        self.synth.stop()
        try:
            self.root.destroy()
        except Exception:
            pass


# =========================================================================
# LOBBY DE LANCEMENT ET EXECUTION CLI / GUI
# =========================================================================
def run_gui() -> None:
    root = tk.Tk()
    app = KeygenApp(root)
    app.start_marquee()
    root.mainloop()


def main() -> int:
    p = argparse.ArgumentParser(
      description="OVERMIND BEARER KEYGEN 2000 — Générateur rétro sécurisé d'adresses et clés privées EVM"
    )
    p.add_argument("--cli", action="store_true", help="Forcer le mode console CLI")
    p.add_argument("--count", type=int, default=1, help="Nombre de clés à générer (mode CLI)")
    p.add_argument("--out", type=str, default=None, help="Exporter les résultats en format JSON dans un fichier")
    p.add_argument("--no-0x", action="store_true", help="Générer la clé privée brute sans préfixe 0x")
    args = p.parse_args()

    # Si Tkinter est indisponible ou si l'utilisateur spécifie explicitement le mode CLI
    if not GUI_AVAILABLE or args.cli or args.out or args.count > 1:
        if args.count < 1 or args.count > 1000:
            sys.stderr.write("Erreur : --count doit être compris entre 1 et 1000.\n")
            return 1
        keys: list[dict[str, str]] = [gen_one(no_0x=args.no_0x) for _ in range(args.count)]
        payload: Any = keys[0] if args.count == 1 else keys
        text = json.dumps(payload, indent=2)
        
        if args.out:
            tmp = args.out + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(text)
                f.write("\n")
            try:
                os.chmod(tmp, 0o600)  # Restreindre la lecture/écriture au propriétaire de la machine
            except Exception:
                pass
            os.replace(tmp, args.out)
            sys.stderr.write(f"Succès : {len(keys)} clé(s) écrite(s) dans '{args.out}' (droits 0600).\n")
        else:
            sys.stdout.write(text + "\n")
        return 0

    run_gui()
    return 0


if __name__ == "__main__":
    sys.exit(main())
