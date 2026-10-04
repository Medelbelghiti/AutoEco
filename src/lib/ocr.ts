export interface OcrResult {
  status: "ok" | "unavailable" | "low_confidence";
  message?: string;
  fields: {
    merchant?: string;
    amountCents?: number;
    currency?: string;
    date?: string;
    category?: string;
    mileage?: number;
    taxCents?: number;
    description?: string;
  };
  confidence: number;
}

export interface OcrInput { bytes: Buffer; mimeType: string; }

export interface OcrProvider {
  name: string;
  available: boolean;
  extract(input: OcrInput): Promise<OcrResult>;
}

export const DefaultOcrProvider: OcrProvider = {
  name: "disabled",
  available: false,
  async extract(): Promise<OcrResult> {
    return {
      status: "unavailable",
      message: "Receipt OCR is not configured on this server. Please enter the expense details manually below.",
      fields: {},
      confidence: 0,
    };
  },
};

let _provider: OcrProvider = DefaultOcrProvider;
export function getOcrProvider(): OcrProvider { return _provider; }
export function setOcrProvider(p: OcrProvider): void { _provider = p; }
