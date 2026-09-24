import type { Mermaid } from 'mermaid';
import type { DOMPurify } from 'dompurify';

declare global {
  interface Window {
    /** Optional globals supplied by the diagram page's bundled vendor scripts. */
    mermaid?: Pick<Mermaid, 'initialize' | 'render'>;
    DOMPurify?: DOMPurify;
  }
}
