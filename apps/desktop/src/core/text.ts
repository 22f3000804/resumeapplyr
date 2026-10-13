// Built from escapes so this source file stays free of literal replacement chars.
const REPLACEMENT_ARTIFACT = /(?:�|ï¿½)+/g;

/**
 * Restores a dash from replacement-char artifacts left when an agent's typed em-dash is mangled by
 * a shell's encoding. The original char is lost; it was always a dash.
 *
 * Ported from JobPilot (https://github.com/suxrobgm/jobpilot), MIT License.
 */
export function cleanReplacementChars(value: string): string {
  return value.replace(REPLACEMENT_ARTIFACT, "-");
}
