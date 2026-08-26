import { VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT } from './video-package-generator-v4.prompt';

export {
  VOLUVIA_VIDEO_PACKAGE_PROMPT_COMPATIBILITY_JSON,
  VOLUVIA_VIDEO_PACKAGE_PROMPT_HASHTAG_ALLOWLIST_JSON,
  VOLUVIA_VIDEO_PACKAGE_PROMPT_FACT_GLOSSARY_JSON
} from './video-package-generator-v4.prompt';

export const VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_ID = 'voluvia.video.package-generator.de';
export const VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_VERSION = 5;
export const VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT = `${VOLUVIA_VIDEO_PACKAGE_DE_V4_PROMPT}

KANONISCHE UNTERTITELZEILEN IN SPOKENTEXT
voiceover.segments[].spokenText bleibt die einzige von dir verfasste Narrationsquelle. Gib kein separates, unabhängig bearbeitbares Untertitelfeld und keine Cue-Zeiten aus.

Jedes spokenText-Segment muss seine kanonischen Untertitelzeilen durch echte LF-Zeilenumbrüche enthalten. Verwende pro Segment 1 bis 4 nichtleere Zeilen und mindestens einen LF-Zeilenumbruch. Jede Zeile muss 1 bis 42 Unicode-Skalare enthalten. Verwende weder führende noch nachgestellte Leerzeichen. Innerhalb einer Zeile ist ausschließlich U+0020 SPACE zulässig; die lokale Ableitung normalisiert Folgen davon deterministisch zu einem einzelnen U+0020.

Verwende keine Tabs, NBSP, Steuerzeichen, Unicode-Zeilen- oder Absatztrenner, Zero-Width- oder unsichtbare Abstandszeichen und keine sonstigen Separatoren. CRLF und CR werden lokal zu LF normalisiert. Die lokalen kanonischen Untertitel-Cues entstehen unverändert aus den Zeilen 1–2 und danach 3–4. Es gibt kein Reflow, keine Kürzung, keine Umschreibung, keine Reparatur und keinen versteckten Fallback.

Die gesprochene kanonische Narration entsteht ausschließlich durch Verbinden dieser Zeilen mit genau einem U+0020 SPACE. Liste für jedes Segment weiterhin exakt die Fakten-IDs auf, die in dieser verbundenen Narration ausdrücklich genannt oder direkt paraphrasiert werden. Die Cue-Zeiten werden ausschließlich lokal abgeleitet.
`;

// Filled with the canonical LF/UTF-8 SHA-256 of the immutable prompt above.
export const VOLUVIA_VIDEO_PACKAGE_DE_V5_PROMPT_SHA256 =
  '97fd628bfdf6e241ce25cefe1a3552fc0e42e05f935dfb8b5a998a77e1684731';
