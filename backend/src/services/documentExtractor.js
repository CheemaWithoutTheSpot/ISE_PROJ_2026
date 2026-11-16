import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import { AppError } from '../errors.js';

export async function extractText(buffer, mimeType) {
  try {
    let text;
    if (mimeType === 'application/pdf') {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str || '').join(' '));
      }
      text = pages.join('\n');
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      text = (await mammoth.extractRawText({ buffer })).value;
    } else if (mimeType === 'application/msword') {
      const document = await new WordExtractor().extract(buffer);
      text = document.getBody();
    } else {
      throw new AppError(422, 'This file needs manual grading.', 'unsupported_extraction');
    }
    if (!text?.trim()) throw new AppError(422, 'No readable text was found. This file needs manual grading.', 'empty_document');
    if (text.length > 200_000) throw new AppError(422, 'Extracted document text is too long for automatic evaluation.', 'document_too_long');
    return text.trim();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, 'The document could not be read and needs manual grading.', 'unreadable_document');
  }
}