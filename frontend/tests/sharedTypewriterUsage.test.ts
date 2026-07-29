import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sharedTypewriterSurfaces = [
  '../src/components/chat/ChatApp.tsx',
  '../src/components/AskAIResult.tsx',
  '../src/components/video-player/components/AskAiView.tsx',
  '../src/components/audio-player/AskAiTab.tsx',
];

describe('shared AI typewriter integration', () => {
  for (const relativePath of sharedTypewriterSurfaces) {
    it(`${relativePath} uses the shared TypewriterMessage`, () => {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
      expect(source).toMatch(/import TypewriterMessage from ['"].*TypewriterMessage['"]/);
      expect(source).toContain('<TypewriterMessage');
    });
  }
});
