
import { createWorker } from "tesseract.js";

let workerPromise;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng").catch((error) => {
      workerPromise = null;
      throw error;
    });
  }

  return workerPromise;
}

export async function extractTextFromImage(file, onProgress) {
  const worker = await getWorker();

  const result = await worker.recognize(file, {}, {
    text: true,
  });

  if (onProgress) {
    onProgress(100);
  }

  return result.data.text;
}


export function parseBillText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Suggest a vendor from the beginning of the receipt.
  const vendor =
    lines.find(
      (line) =>
        /[a-zA-Z]/.test(line) &&
        !/receipt|invoice|customer details|support@/i.test(line)
    ) || "";

  // Extract a date in YYYY-MM-DD or DD/MM/YYYY format.
  const dateMatch = text.match(
    /\b(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/
  );

  let date = "";

  if (dateMatch) {
    const value = dateMatch[1];

    if (/^\d{4}-/.test(value)) {
      date = value;
    } else {
      const [day, month, year] = value.split(/[/-]/);
      date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
  }

  // Look for a total label and its amount on the same line.
  // Match Grand Total before the more general Total label.
  const totalLabels =
    /(?:grand\s+total|amount\s+payable|total\s+due|net\s+amount|total)\s*:?\s*[$₹£€]?\s*(?:rs\.?\s*)?([\d,]+(?:\.\d{1,2})?)/i;

  let amount = 0;

  for (const line of lines) {
    const match = line.match(totalLabels);

    if (match) {
      const value = Number(match[1].replace(/,/g, ""));

      if (Number.isFinite(value)) {
        amount = value;
        break;
      }
    }
  }

  return { vendor, date, amount };
}
