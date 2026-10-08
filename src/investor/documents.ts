import { createDecipheriv } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { accessConfiguration } from './access';

export const DOCUMENTS = {
  'pitch-deck.pdf': {
    format: 'pdf',
    mime: 'application/pdf',
    encryptedFile: 'pitch-deck-en.pdf.enc',
    filename: 'DAJC_Investor_Pitch_Deck_EN_v2_2026-10-07.pdf',
  },
  'pitch-deck.pptx': {
    format: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    encryptedFile: 'pitch-deck-en.pptx.enc',
    filename: 'DAJC_Investor_Pitch_Deck_EN_v2_2026-10-07.pptx',
  },
} as const;

export async function readInvestorDocument(name: keyof typeof DOCUMENTS) {
  const config = accessConfiguration();
  if (!config) throw new Error('Investor access is unavailable');
  const document = DOCUMENTS[name];
  const encrypted = await readFile(join(process.cwd(), 'private/investor', document.encryptedFile));
  if (encrypted.length < 33 || encrypted.subarray(0, 5).toString('ascii') !== 'DAJC1') {
    throw new Error('Invalid document envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', config.key, encrypted.subarray(5, 17));
  decipher.setAAD(Buffer.from(`DAJC:investor:${document.format}:2026-10-07:v2`));
  decipher.setAuthTag(encrypted.subarray(17, 33));
  // Authenticate the complete encrypted file before releasing any plaintext.
  return Buffer.concat([decipher.update(encrypted.subarray(33)), decipher.final()]);
}

export function documentStream(bytes: Buffer) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}
