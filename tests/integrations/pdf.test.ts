import { describe,expect,it } from 'vitest';
import { renderIntegrationPdf } from '../../src/lib/integrations/pdf';

describe('DAJC integration architecture PDFs',()=>{
  for(const product of ['platform','tar'] as const){
    it('generates an eight-page PDF for '+product,()=>{
      const pdf=renderIntegrationPdf(product);
      const text=new TextDecoder().decode(pdf);
      expect(pdf.byteLength).toBeGreaterThan(12000);
      expect(text.startsWith('%PDF-1.4')).toBe(true);
      expect(text).toMatch(/\/Count 8\b/);
      expect((text.match(/\/Type \/Page \/Parent/g)||[]).length).toBe(8);
      expect(text).toContain('Conceptual technical architecture');
      expect(text.endsWith('%%EOF')).toBe(true);
      expect(text).toContain(product==='platform'?'DAJC PLATFORM':'DAJC TAR');
    });
  }
});
