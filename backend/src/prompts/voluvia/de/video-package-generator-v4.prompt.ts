import { VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT } from './video-package-generator-v3.prompt';

export {
  VOLUVIA_VIDEO_PACKAGE_PROMPT_COMPATIBILITY_JSON,
  VOLUVIA_VIDEO_PACKAGE_PROMPT_HASHTAG_ALLOWLIST_JSON,
  VOLUVIA_VIDEO_PACKAGE_PROMPT_FACT_GLOSSARY_JSON
} from './video-package-generator-v3.prompt';

export const VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_ID = 'voluvia.video.package-generator.de';
export const VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_VERSION = 4;
export const VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT = `${VOLUVIA_VIDEO_PACKAGE_DE_V3_PROMPT}

SPRECHDAUER UND NARRATIONSBUDGET
Die lokale Prüfung ist maßgeblich und schätzt estimatedSpokenSeconds als ceil(totalCanonicalWordCount / 2.25). Die gesamte deutsche Narration muss abhängig von presenterMode und targetDurationSeconds innerhalb dieser unveränderten Belegungsbereiche liegen:
- product-only: 20 s = 10–18 s (ungefähr 23–40 Wörter), 30 s = 15–27 s (ungefähr 34–60 Wörter), 45 s = 23–40 s (ungefähr 52–90 Wörter).
- presenter-plus-product: 20 s = 13–20 s (ungefähr 30–45 Wörter), 30 s = 20–30 s (ungefähr 45–67 Wörter), 45 s = 30–45 s (ungefähr 68–101 Wörter).

Ziele auf einen sicheren Wert ungefähr in der Mitte des passenden Wortbereichs, nicht auf dessen exaktes Minimum oder Maximum. Praktische Mittelpunkte sind ungefähr 31, 47 und 71 Wörter für product-only bei 20, 30 und 45 Sekunden sowie ungefähr 37, 56 und 84 Wörter für presenter-plus-product. Erzeuge für jede Planner-Szene genau ein Voiceover-Segment. Verteile das gesamte Narrationsbudget proportional zur Dauer der Planner-Szenen auf alle Segmente. Jedes Segment muss natürlich gesprochenes Deutsch enthalten und sicher unter der lokalen Sprechkapazität seiner Szene bleiben; vermeide extrem kurze Segmente.

Erreiche das Narrationsbudget niemals durch leere Füllsätze, Wiederholungen, mehrfach wiederholte Fakten oder Claims, redundante Aussagen, erfundene Vorteile, Dringlichkeit, Knappheit oder wiederholte Aufforderungen wie „Jetzt entdecken!“. Faktenattribution, Hashtag-Regeln und alle Sicherheitsregeln bleiben unverändert. Führe keine abweichende exakte Provider-Arithmetik ein; die lokale Prüfung entscheidet endgültig.
`;

// Filled with the canonical LF/UTF-8 SHA-256 of the immutable prompt above.
export const VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT_SHA256 =
  '5a74157f539206fdbf18bbc7f199f154045bb14ec85059ea2255fa0b33be4532';
