"""Run with the portable model Python; no downloads, original synthetic signals only."""

import sys
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "plugins/audio-harmony"))
from melody import phrases_from_frames, vocal_melody


class VocalEvidenceTests(unittest.TestCase):
    def test_phrase_keeps_short_octave_error_inside_sustain_and_splits_true_repeat(self):
        midi = np.full(100, 60)
        midi[20:24] = 72
        audible = np.full(100, 0.2)
        audible[47:50] = 0.06
        audible[80:90] = 0
        attacks = [
            dict(start=t, score=0.9, pitch=dict(midi=60))
            for t in (0.35, 0.5)
        ]
        phrases = phrases_from_frames(
            midi, np.ones(100, dtype=bool), np.full(100, 0.9),
            audible, np.zeros(100), attacks, 0, 1,
        )
        truth = [(60, 0, 0.5), (60, 0.5, 0.3), (60, 0.9, 0.1)]
        self.assertEqual(len(phrases), len(truth))
        for phrase, (pitch, start, duration) in zip(phrases, truth):
            self.assertEqual(phrase["pitch"]["midi"], pitch)
            self.assertAlmostEqual(phrase["start"], start)
            self.assertAlmostEqual(phrase["duration"], duration)

    def test_sustain_crosses_window_without_a_new_attack(self):
        sr = 16000
        t = np.arange(sr * 11) / sr
        y = 0.2 * np.sin(2 * np.pi * 220 * t)
        notes = vocal_melody(y, np.zeros_like(y), sr, [])
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["pitch"]["midi"], 57)
        self.assertGreater(notes[0]["duration"], 10.8)

    def test_independent_same_pitch_attack_remains_at_boundary(self):
        sr = 16000
        t = np.arange(sr * 11) / sr
        y = 0.2 * np.sin(2 * np.pi * 220 * t)
        onset = dict(start=10.0, score=0.9, pitch=dict(midi=57))
        notes = vocal_melody(y, np.zeros_like(y), sr, [onset])
        self.assertEqual(len(notes), 2)
        self.assertAlmostEqual(notes[1]["start"], 10.0, delta=0.05)

    def test_silence_and_vocal_leakage_do_not_create_evidence(self):
        y = np.zeros(16000)
        self.assertEqual(vocal_melody(y, y, 16000, []), [])
        t = np.arange(16000) / 16000
        tone = 0.2 * np.sin(2 * np.pi * 220 * t)
        self.assertEqual(vocal_melody(tone * 0.01, tone, 16000, []), [])


if __name__ == "__main__":
    unittest.main()
